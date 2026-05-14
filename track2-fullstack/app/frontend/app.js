const API_BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(API_BASE + path, options);
  const text = await res.text();

  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const detail = payload && typeof payload === 'object' ? payload.error : null;
    const error = new Error(detail || `${options.method || 'GET'} ${path} failed: ${res.status}`);
    error.status = res.status;
    throw error;
  }

  return payload;
}

const api = {
  async get(path) {
    return request(path);
  },
  async post(path, body) {
    return request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  async put(path, body) {
    return request(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  async delete(path) {
    return request(path, { method: 'DELETE' });
  },
};
