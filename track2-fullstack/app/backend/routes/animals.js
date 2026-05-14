const express = require('express');
const router = express.Router();
const { db } = require('../db');

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function runInTransaction(work) {
  db.exec('BEGIN');

  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback failures after the original error.
    }

    throw error;
  }
}

function sendWriteError(res, error, fallbackMessage) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.message });
  }

  if (typeof error?.message === 'string' && error.message.includes('UNIQUE constraint failed: animals.tag_number')) {
    return res.status(409).json({ error: 'tag_number must be unique' });
  }

  return res.status(500).json({ error: fallbackMessage });
}

router.get('/', (req, res) => {
  const parsedPage = Number.parseInt(req.query.page, 10);
  const parsedLimit = Number.parseInt(req.query.limit, 10);
  const page = Number.isInteger(parsedPage) && parsedPage >= 0 ? parsedPage : 0;
  const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10;
  const offset = page * limit;

  const animals = db.prepare(
    'SELECT * FROM animals LIMIT ? OFFSET ?'
  ).all(limit, offset);

  const result = animals.map(animal => {
    const latestEvent = db.prepare(`
      SELECT * FROM health_events
      WHERE animal_id = ?
      ORDER BY date DESC
      LIMIT 1
    `).get(animal.id);
    return { ...animal, latest_health_event: latestEvent ?? null };
  });

  res.json(result);
});

router.post('/', (req, res) => {
  const { name, tag_number, breed, date_of_birth, paddock_id } = req.body;

  if (!name || !tag_number) {
    return res.status(400).json({ error: 'name and tag_number are required' });
  }

  const nextPaddockId = paddock_id ?? null;

  try {
    const animal = runInTransaction(() => {
      if (nextPaddockId !== null) {
        const paddock = db.prepare('SELECT id FROM paddocks WHERE id = ?').get(nextPaddockId);
        if (!paddock) {
          throw createHttpError(404, 'Paddock not found');
        }
      }

      const result = db.prepare(
        'INSERT INTO animals (name, tag_number, breed, date_of_birth, paddock_id) VALUES (?, ?, ?, ?, ?)'
      ).run(name, tag_number, breed ?? null, date_of_birth ?? null, nextPaddockId);

      if (nextPaddockId !== null) {
        db.prepare(
          'UPDATE paddocks SET animal_count = animal_count + 1 WHERE id = ?'
        ).run(nextPaddockId);
      }

      return db.prepare('SELECT * FROM animals WHERE id = ?').get(result.lastInsertRowid);
    });

    return res.status(201).json(animal);
  } catch (error) {
    return sendWriteError(res, error, 'Unable to create animal');
  }
});

router.get('/:id', (req, res) => {
  const animal = db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });
  res.json(animal);
});

router.put('/:id', (req, res) => {
  const animal = db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });

  const updates = {
    name:          req.body.name          ?? animal.name,
    tag_number:    req.body.tag_number    ?? animal.tag_number,
    breed:         req.body.breed         ?? animal.breed,
    date_of_birth: req.body.date_of_birth ?? animal.date_of_birth,
    paddock_id:    'paddock_id' in req.body ? req.body.paddock_id : animal.paddock_id,
  };

  try {
    const updated = runInTransaction(() => {
      if (updates.paddock_id !== animal.paddock_id && updates.paddock_id !== null) {
        const paddock = db.prepare('SELECT id FROM paddocks WHERE id = ?').get(updates.paddock_id);
        if (!paddock) {
          throw createHttpError(404, 'Paddock not found');
        }
      }

      db.prepare(`
        UPDATE animals
        SET name = ?, tag_number = ?, breed = ?, date_of_birth = ?, paddock_id = ?
        WHERE id = ?
      `).run(updates.name, updates.tag_number, updates.breed, updates.date_of_birth, updates.paddock_id, req.params.id);

      if (updates.paddock_id !== animal.paddock_id) {
        if (animal.paddock_id !== null) {
          db.prepare(
            'UPDATE paddocks SET animal_count = animal_count - 1 WHERE id = ?'
          ).run(animal.paddock_id);
        }

        if (updates.paddock_id !== null) {
          db.prepare(
            'UPDATE paddocks SET animal_count = animal_count + 1 WHERE id = ?'
          ).run(updates.paddock_id);
        }
      }

      return db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
    });

    return res.json(updated);
  } catch (error) {
    return sendWriteError(res, error, 'Unable to update animal');
  }
});

router.delete('/:id', (req, res) => {
  const animal = db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });

  if (animal.paddock_id) {
    db.prepare(
      'UPDATE paddocks SET animal_count = animal_count - 1 WHERE id = ?'
    ).run(animal.paddock_id);
  }

  db.prepare('DELETE FROM animals WHERE id = ?').run(req.params.id);
  res.json({ message: 'deleted' });
});

router.get('/:id/health-events', (req, res) => {
  const animal = db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });

  const events = db.prepare(
    'SELECT * FROM health_events WHERE animal_id = ? ORDER BY date DESC'
  ).all(req.params.id);
  res.json(events);
});

router.post('/:id/health-events', (req, res) => {
  const animal = db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });

  const { event_type, notes, date, vet_name } = req.body;
  if (!event_type || !date) {
    return res.status(400).json({ error: 'event_type and date are required' });
  }

  const result = db.prepare(
    'INSERT INTO health_events (animal_id, event_type, notes, date, vet_name) VALUES (?, ?, ?, ?, ?)'
  ).run(req.params.id, event_type, notes ?? null, date, vet_name ?? null);

  const event = db.prepare('SELECT * FROM health_events WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(event);
});

router.get('/:id/weights', (req, res) => {
  const animal = db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });

  const weights = db.prepare(
    'SELECT * FROM animal_weights WHERE animal_id = ? ORDER BY date DESC'
  ).all(req.params.id);

  res.json(weights);
});

router.post('/:id/weights', (req, res) => {
  const animal = db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });

  const { weight_kg, date, notes } = req.body;
  const parsedWeight = typeof weight_kg === 'number' ? weight_kg : Number.NaN;

  if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
    return res.status(422).json({ error: 'weight_kg must be a positive number' });
  }

  if (!date) {
    return res.status(422).json({ error: 'date is required' });
  }

  const result = db.prepare(
    'INSERT INTO animal_weights (animal_id, weight_kg, date, notes) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, parsedWeight, date, notes ?? null);

  const weight = db.prepare('SELECT * FROM animal_weights WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(weight);
});

module.exports = router;
