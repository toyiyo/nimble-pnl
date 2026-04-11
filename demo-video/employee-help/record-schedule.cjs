const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const DIR = __dirname;
const CLIPS_DIR = path.join(DIR, 'clips');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const stateFile = path.join(DIR, 'auth-sched.json');
  const ts = Date.now();

  // Sign up fresh
  console.log('Setting up...');
  const ctx1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p1 = await ctx1.newPage();
  await p1.goto('http://localhost:8080/auth', { waitUntil: 'networkidle' });
  await sleep(2000);
  await p1.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await p1.reload({ waitUntil: 'networkidle' });
  await sleep(2000);
  try { await p1.getByRole('button', { name: 'Not now' }).click({ timeout: 2000 }); } catch {}
  await p1.getByRole('tab', { name: /sign up/i }).click();
  await sleep(500);
  await p1.getByRole('textbox', { name: 'Email' }).fill(`sched-${ts}@test.com`);
  await p1.getByRole('textbox', { name: 'Full Name' }).fill('Maria Rodriguez');
  await p1.getByRole('textbox', { name: 'Password' }).fill('TestPassword123!');
  await p1.getByRole('button', { name: /sign up/i }).click();
  await sleep(6000);
  try { await p1.getByRole('button', { name: 'Get Started' }).click({ timeout: 3000 }); } catch {}
  await sleep(2000);
  try { await p1.keyboard.press('Escape'); } catch {}
  await sleep(500);

  // Create restaurant
  await p1.getByRole('button', { name: /add restaurant/i }).click({ timeout: 5000 });
  await sleep(1000);
  const dlg = p1.getByRole('dialog').filter({ hasText: /add new restaurant/i });
  await dlg.getByLabel(/restaurant name/i).fill('The Garden Bistro');
  await dlg.getByRole('button', { name: /create/i }).click();
  await sleep(3000);
  try { await p1.keyboard.press('Escape'); } catch {}
  await sleep(1000);

  // Seed data
  await p1.evaluate(async () => {
    const { supabase } = await import('/src/integrations/supabase/client');
    const { data: { user } } = await supabase.auth.getUser();
    const { data: ur } = await supabase.from('user_restaurants').select('restaurant_id').eq('user_id', user.id).limit(1).single();
    const rid = ur.restaurant_id;
    await supabase.from('restaurants').update({ subscription_tier: 'pro', subscription_status: 'active' }).eq('id', rid);

    const { data: emp } = await supabase.from('employees').insert({
      restaurant_id: rid, name: 'Maria Rodriguez', position: 'Server',
      hourly_rate: 1600, status: 'active', user_id: user.id,
    }).select().single();

    const today = new Date();
    const shifts = [];
    for (let d = -3; d <= 7; d++) {
      const date = new Date(today);
      date.setDate(today.getDate() + d);
      const ds = date.toISOString().slice(0, 10);
      shifts.push({
        restaurant_id: rid, employee_id: emp.id, position: 'Server',
        start_time: `${ds}T09:00:00-05:00`, end_time: `${ds}T17:00:00-05:00`,
        break_duration: 30, status: d < 0 ? 'completed' : 'scheduled',
      });
    }
    await supabase.from('shifts').insert(shifts);
    await supabase.from('user_restaurants').update({ role: 'staff' }).eq('restaurant_id', rid).eq('user_id', user.id);
  });
  console.log('  Data seeded.');

  await ctx1.storageState({ path: stateFile });
  await p1.close();
  await ctx1.close();

  // Pre-load the page so data is cached
  console.log('Pre-loading page...');
  const preCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: stateFile });
  const preP = await preCtx.newPage();
  await preP.goto('http://localhost:8080/employee/schedule', { waitUntil: 'networkidle' });
  await sleep(8000);
  // Clear help video seen state so cards show expanded
  await preP.evaluate(() => {
    Object.keys(localStorage).filter(k => k.startsWith('help_video')).forEach(k => localStorage.removeItem(k));
  });
  await preCtx.storageState({ path: stateFile });
  await preP.close();
  await preCtx.close();

  // Record
  console.log('Recording schedule...');
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: stateFile,
    recordVideo: { dir: CLIPS_DIR, size: { width: 390, height: 844 } },
  });
  const p = await ctx.newPage();
  await p.goto('http://localhost:8080/employee/schedule', { waitUntil: 'networkidle' });
  await sleep(6000);

  // Scroll slowly to show the shifts
  for (let y = 0; y <= 600; y += 100) {
    await p.evaluate((scrollY) => window.scrollTo({ top: scrollY, behavior: 'smooth' }), y);
    await sleep(1000);
  }
  await sleep(3000);

  const video = p.video();
  await p.close();
  await ctx.close();
  if (video) {
    const vp = await video.path();
    fs.renameSync(vp, path.join(CLIPS_DIR, 'schedule.webm'));
    console.log('  Saved schedule.webm');
  }

  fs.unlinkSync(stateFile);
  await browser.close();
  console.log('Done!');
})();
