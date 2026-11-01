import { api, setSession } from '../api.js';
import { el, field } from '../util.js';

export async function mount(root, { onSignedIn }) {
  const email = el('input', { type: 'email', autocomplete: 'username', required: true });
  const password = el('input', { type: 'password', autocomplete: 'current-password', required: true });
  const err = el('div', { class: 'form-error', role: 'alert' });
  const btn = el('button', { class: 'btn primary', type: 'submit' }, 'Sign in');
  const demo = el('div', { class: 'demo-box' });

  const form = el('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    try {
      const r = await api('POST', '/auth/login', { email: email.value, password: password.value });
      setSession(r.token, r.user);
      onSignedIn();
    } catch (ex) { err.textContent = ex.message; } finally { btn.disabled = false; }
  } }, field('Email', email), field('Password', password), err, btn);

  root.replaceChildren(el('div', { class: 'login' },
    el('div', { class: 'card' },
      el('h1', {}, 'GEDT Registry'),
      el('p', { class: 'lead' }, 'A shared map of telecom devices and fibre routes, with fibre cut alerts.'),
      form, demo)));

  try {
    const h = await fetch('/api/health').then((r) => r.json());
    if (h.demo) {
      const accounts = [['Field Technician', 'chinedu.eze@lagoon-telecom.example'], ['Asset Manager', 'tunde.bakare@lagoon-telecom.example'],
        ['Decision Maker', 'femi.adeyemi@lagoon-telecom.example'], ['GIS Administrator', 'adaeze.okafor@lagoon-telecom.example'],
        ['Other operator (manager)', 'ibrahim.danjuma@harmattan-networks.example']];
      demo.append(el('hr'), el('strong', {}, 'Demonstration accounts'),
        el('p', {}, 'Click a role to fill the form. The password is Demo@12345. All data is invented.'),
        ...accounts.map(([name, mail]) => el('button', { class: 'btn small', type: 'button', onclick: () => { email.value = mail; password.value = 'Demo@12345'; password.focus(); } }, name)));
    }
  } catch { /* the sign-in form still works */ }
}
