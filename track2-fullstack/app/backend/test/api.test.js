const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farmtracker-test-'));
process.env.FARMTRACKER_DB_PATH = path.join(tempDir, 'farmtracker.db');

const app = require('../server');
const { db } = require('../db');

let server;
let baseUrl;

before(async () => {
  seedTestData();
  server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function seedTestData() {
  db.exec('DELETE FROM animal_weights; DELETE FROM health_events; DELETE FROM animals; DELETE FROM paddocks;');

  const northId = db.prepare(
    'INSERT INTO paddocks (name, capacity, animal_count) VALUES (?, ?, 0)'
  ).run('North Paddock', 50).lastInsertRowid;

  const southId = db.prepare(
    'INSERT INTO paddocks (name, capacity, animal_count) VALUES (?, ?, 0)'
  ).run('South Paddock', 30).lastInsertRowid;

  const insertAnimal = db.prepare(
    'INSERT INTO animals (name, tag_number, breed, date_of_birth, paddock_id) VALUES (?, ?, ?, ?, ?)'
  );

  const bellaId = insertAnimal.run('Bella', 'TAG-001', 'Merino', '2021-03-14', northId).lastInsertRowid;
  insertAnimal.run('Daisy', 'TAG-002', 'Dorper', '2020-07-22', southId);

  db.prepare('UPDATE paddocks SET animal_count = animal_count + 1 WHERE id = ?').run(northId);
  db.prepare('UPDATE paddocks SET animal_count = animal_count + 1 WHERE id = ?').run(southId);

  db.prepare(
    'INSERT INTO health_events (animal_id, event_type, notes, date, vet_name) VALUES (?, ?, ?, ?, ?)'
  ).run(bellaId, 'vaccination', 'Routine vaccination', '2024-01-15', 'Dr. Walsh');
}

async function get(path) {
  const res = await fetch(baseUrl + path);
  return { status: res.status, body: await res.json() };
}

async function post(path, body) {
  const res = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function put(path, body) {
  const res = await fetch(baseUrl + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('GET /api/paddocks returns an array', async () => {
  const { status, body } = await get('/paddocks');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
});

test('GET /api/animals returns animals with latest_health_event field', async () => {
  const { status, body } = await get('/animals?page=0&limit=5');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.length > 0);
  assert.ok('latest_health_event' in body[0]);
});

test('GET /api/animals applies page as a page index instead of a raw row offset', async () => {
  seedTestData();

  const { status: firstStatus, body: firstPage } = await get('/animals?page=0&limit=1');
  const { status: secondStatus, body: secondPage } = await get('/animals?page=1&limit=1');

  assert.equal(firstStatus, 200);
  assert.equal(secondStatus, 200);
  assert.equal(firstPage.length, 1);
  assert.equal(secondPage.length, 1);
  assert.notEqual(firstPage[0].id, secondPage[0].id);
});

test('GET /api/animals/:id returns a single animal', async () => {
  const { body: animals } = await get('/animals?page=0&limit=1');
  const id = animals[0].id;
  const { status, body } = await get(`/animals/${id}`);
  assert.equal(status, 200);
  assert.equal(body.id, id);
});

test('GET /api/animals/:id returns 404 for unknown id', async () => {
  const { status } = await get('/animals/999999');
  assert.equal(status, 404);
});

test('POST /api/animals/:id/health-events creates an event', async () => {
  const { body: animals } = await get('/animals?page=0&limit=1');
  const id = animals[0].id;
  const { status, body } = await post(`/animals/${id}/health-events`, {
    event_type: 'checkup',
    date: '2025-01-10',
    vet_name: 'Dr. Test',
  });
  assert.equal(status, 201);
  assert.equal(body.event_type, 'checkup');
  assert.equal(body.animal_id, id);
});

test('PUT /api/animals/:id moving Bella updates paddock animal counts', async () => {
  seedTestData();

  const northPaddock = db.prepare('SELECT * FROM paddocks WHERE name = ?').get('North Paddock');
  const southPaddock = db.prepare('SELECT * FROM paddocks WHERE name = ?').get('South Paddock');
  const bella = db.prepare('SELECT * FROM animals WHERE name = ?').get('Bella');

  const { status, body } = await put(`/animals/${bella.id}`, {
    paddock_id: southPaddock.id,
  });

  const updatedNorthPaddock = db.prepare('SELECT * FROM paddocks WHERE id = ?').get(northPaddock.id);
  const updatedSouthPaddock = db.prepare('SELECT * FROM paddocks WHERE id = ?').get(southPaddock.id);

  assert.equal(status, 200);
  assert.equal(body.id, bella.id);
  assert.equal(body.paddock_id, southPaddock.id);
  assert.equal(updatedNorthPaddock.animal_count, northPaddock.animal_count - 1);
  assert.equal(updatedSouthPaddock.animal_count, southPaddock.animal_count + 1);
});

test('PUT /api/animals/:id returns 404 when moving an animal to a missing paddock', async () => {
  seedTestData();

  const northPaddock = db.prepare('SELECT * FROM paddocks WHERE name = ?').get('North Paddock');
  const bella = db.prepare('SELECT * FROM animals WHERE name = ?').get('Bella');

  const { status, body } = await put(`/animals/${bella.id}`, {
    paddock_id: 999999,
  });

  const unchangedBella = db.prepare('SELECT * FROM animals WHERE id = ?').get(bella.id);
  const unchangedNorthPaddock = db.prepare('SELECT * FROM paddocks WHERE id = ?').get(northPaddock.id);

  assert.equal(status, 404);
  assert.equal(body.error, 'Paddock not found');
  assert.equal(unchangedBella.paddock_id, northPaddock.id);
  assert.equal(unchangedNorthPaddock.animal_count, northPaddock.animal_count);
});

test('POST /api/animals returns 404 when creating an animal in a missing paddock', async () => {
  seedTestData();

  const animalCountBefore = db.prepare('SELECT COUNT(*) AS count FROM animals').get().count;
  const { status, body } = await post('/animals', {
    name: 'Tilly',
    tag_number: 'TAG-404',
    breed: 'Merino',
    paddock_id: 999999,
  });
  const animalCountAfter = db.prepare('SELECT COUNT(*) AS count FROM animals').get().count;

  assert.equal(status, 404);
  assert.equal(body.error, 'Paddock not found');
  assert.equal(animalCountAfter, animalCountBefore);
});

test('POST /api/animals/:id/weights creates a weight record and returns 201', async () => {
  seedTestData();

  const bella = db.prepare('SELECT * FROM animals WHERE name = ?').get('Bella');
  const { status, body } = await post(`/animals/${bella.id}/weights`, {
    weight_kg: 45.2,
    date: '2024-11-15',
    notes: 'Post-shearing weigh-in',
  });

  assert.equal(status, 201);
  assert.equal(body.animal_id, bella.id);
  assert.equal(body.weight_kg, 45.2);
  assert.equal(body.date, '2024-11-15');
  assert.equal(body.notes, 'Post-shearing weigh-in');
});

test('POST /api/animals/:id/weights returns 422 when weight_kg is missing', async () => {
  seedTestData();

  const bella = db.prepare('SELECT * FROM animals WHERE name = ?').get('Bella');
  const { status } = await post(`/animals/${bella.id}/weights`, {
    date: '2024-11-15',
  });

  assert.equal(status, 422);
});

test('POST /api/animals/:id/weights returns 422 when weight_kg is non-positive', async () => {
  seedTestData();

  const bella = db.prepare('SELECT * FROM animals WHERE name = ?').get('Bella');
  const { status } = await post(`/animals/${bella.id}/weights`, {
    weight_kg: 0,
    date: '2024-11-15',
  });

  assert.equal(status, 422);
});

test('POST /api/animals/:id/weights returns 404 when the animal does not exist', async () => {
  seedTestData();

  const { status } = await post('/animals/999999/weights', {
    weight_kg: 45.2,
    date: '2024-11-15',
  });

  assert.equal(status, 404);
});

test('GET /api/animals/:id/weights returns records ordered by date descending', async () => {
  seedTestData();

  const bella = db.prepare('SELECT * FROM animals WHERE name = ?').get('Bella');
  db.prepare(
    'INSERT INTO animal_weights (animal_id, weight_kg, date, notes) VALUES (?, ?, ?, ?)'
  ).run(bella.id, 43.1, '2024-10-01', 'Early October');
  db.prepare(
    'INSERT INTO animal_weights (animal_id, weight_kg, date, notes) VALUES (?, ?, ?, ?)'
  ).run(bella.id, 45.2, '2024-11-15', 'Post-shearing weigh-in');

  const { status, body } = await get(`/animals/${bella.id}/weights`);

  assert.equal(status, 200);
  assert.equal(body.length, 2);
  assert.equal(body[0].date, '2024-11-15');
  assert.equal(body[1].date, '2024-10-01');
});
