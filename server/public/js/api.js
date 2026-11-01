let token = sessionStorage.getItem('gedt_token') || null;
export const session = { user: JSON.parse(sessionStorage.getItem('gedt_user') || 'null') };

export function setSession(t, user) {
  token = t; session.user = user;
  if (t) { sessionStorage.setItem('gedt_token', t); sessionStorage.setItem('gedt_user', JSON.stringify(user)); }
  else { sessionStorage.removeItem('gedt_token'); sessionStorage.removeItem('gedt_user'); }
}
export const isSignedIn = () => Boolean(token);

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function send(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && token && path !== '/auth/login') {
    setSession(null, null);
    window.dispatchEvent(new Event('gedt:signedout'));
  }
  return res;
}

export async function api(method, path, body) {
  const res = await send(method, path, body);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) throw new ApiError((json && json.error) || `Request failed (${res.status})`, res.status);
  return json;
}

export async function download(path, filename) {
  const res = await send('GET', path);
  if (!res.ok) { let m = `Download failed (${res.status})`; try { m = (await res.json()).error || m; } catch { /* ignore */ } throw new ApiError(m, res.status); }
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
