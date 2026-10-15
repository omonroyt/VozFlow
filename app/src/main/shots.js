// Solo para desarrollo: genera capturas de cada estado (VOZFLOW_SHOTS=carpeta).
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runShots({ app, SHOTS_DIR, getPill, openSettings, getSettings, setPhase }) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  console.log('shots start');
  getPill().webContents.on('console-message', (e, level, message) => console.log('[pill]', message || e.message));
  process.on('unhandledRejection', (e) => {
    console.log('REJ', e);
    app.exit(1);
  });
  const pill = getPill();
  const loaded = (wc) => (wc.isLoading() ? new Promise((r) => wc.once('did-finish-load', r)) : Promise.resolve());
  await loaded(pill.webContents);
  pill.showInactive();
  await sleep(600);

  const save = async (win, name) => {
    console.log('shot', name);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(SHOTS_DIR, `${name}.png`), img.toPNG());
  };
  const js = (code) => pill.webContents.executeJavaScript(code);
  const base = { idleVisible: true, shortcut: 'Ctrl + Win' };

  await js(`__render(${JSON.stringify({ ...base, state: 'idle', mode: 'text' })})`);
  await sleep(400);
  await save(pill, 'pill-01-idle');

  await js(`document.getElementById('pill').classList.add('is-open')`);
  await sleep(500);
  await save(pill, 'pill-02-idle-open');

  await js(`__render(${JSON.stringify({ ...base, state: 'recording', mode: 'text' })}); __fakeLevel(0.7)`);
  await sleep(500);
  await js(`__fakeLevel(0.75)`);
  await save(pill, 'pill-03-recording');

  await js(`__render(${JSON.stringify({ ...base, state: 'recording', mode: 'prompt', handsFree: true })}); __fakeLevel(0.6)`);
  await sleep(500);
  await save(pill, 'pill-04-recording-prompt-handsfree');

  await js(`__render(${JSON.stringify({ ...base, state: 'processing', mode: 'text', label: 'Limpiando tu texto' })})`);
  await sleep(500);
  await save(pill, 'pill-05-processing');

  await js(
    `__render(${JSON.stringify({ ...base, state: 'suggesting', mode: 'prompt', missing: ['rol', 'restricciones'], timeoutSec: 15 })})`
  );
  await sleep(1500);
  await save(pill, 'pill-06-suggesting');

  await js(`__render(${JSON.stringify({ ...base, state: 'done', mode: 'text', message: 'Pegado' })})`);
  await sleep(500);
  await save(pill, 'pill-07-done');

  await js(
    `__render(${JSON.stringify({ ...base, state: 'error', mode: 'text', message: 'Falta tu API key de Groq', action: 'settings' })})`
  );
  await sleep(500);
  await save(pill, 'pill-08-error');

  openSettings();
  const sw = getSettings();
  await loaded(sw.webContents);
  if (process.env.VOZFLOW_SHOT_H) sw.setSize(1080, Number(process.env.VOZFLOW_SHOT_H));
  await sleep(900);
  for (const page of ['inicio', 'conexion', 'atajos', 'microfono', 'preferencias', 'recientes']) {
    await sw.webContents.executeJavaScript(`location.hash = '${page}'`);
    await sleep(500);
    await save(sw, `settings-${page}`);
    if (page === 'inicio' || page === 'atajos') {
      await sw.webContents.executeJavaScript(`document.getElementById('main').scrollTop = 99999`);
      await sleep(300);
      await save(sw, `settings-${page}-abajo`);
    }
  }
  await sw.webContents.executeJavaScript(
    `document.querySelectorAll('.combos .key').forEach(k => { if (k.dataset.mod==='ctrl'||k.dataset.mod==='meta') k.classList.add('is-down') }); location.hash='inicio'`
  );
  await sleep(500);
  await save(sw, 'settings-inicio-keys-down');
  app.exit(0);
}

module.exports = { runShots };
