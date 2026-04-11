const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const DIR = __dirname;
const CLIPS_DIR = path.join(DIR, 'clips');
const AUDIO_DIR = path.join(DIR, 'audio');
const BASE_URL = 'http://localhost:8080'; // Main dev server with seed data

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getDuration(file) {
  return parseFloat(execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${file}"`
  ).toString().trim());
}

(async () => {
  fs.mkdirSync(CLIPS_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  // Step 1: Sign up a fresh account
  const ts = Date.now();
  const email = `help-demo-${ts}@test.com`;
  console.log(`Signing up ${email}...`);
  const ctx1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx1.newPage();
  await page.goto(`${BASE_URL}/auth`);
  await sleep(1000);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(2000);
  try { await page.getByRole('button', { name: 'Not now' }).click({ timeout: 3000 }); } catch {}
  await sleep(500);

  // Sign up
  await page.getByRole('tab', { name: /sign up/i }).click();
  await sleep(500);
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Full Name' }).fill('Maria Rodriguez');
  await page.getByRole('textbox', { name: 'Password' }).fill('TestPassword123!');
  await page.getByRole('button', { name: /sign up/i }).click();
  await sleep(6000);
  try { await page.getByRole('button', { name: 'Get Started' }).click({ timeout: 3000 }); } catch {}
  await sleep(2000);

  // Create restaurant
  const addBtn = page.getByRole('button', { name: /add restaurant/i });
  await addBtn.waitFor({ timeout: 10000 }).catch(() => {});
  // Close onboarding if blocking
  try {
    const drawer = page.locator('[role="dialog"]').filter({ hasText: /getting started/i });
    if (await drawer.isVisible({ timeout: 2000 })) {
      await page.keyboard.press('Escape');
      await sleep(500);
    }
  } catch {}
  await addBtn.click({ timeout: 5000 });
  await sleep(1000);
  const dialog = page.getByRole('dialog').filter({ hasText: /add new restaurant/i });
  await dialog.getByLabel(/restaurant name/i).fill('The Garden Bistro');
  await dialog.getByRole('button', { name: /create/i }).click();
  await sleep(3000);
  // Close onboarding drawer if it reappears
  try {
    const drawer2 = page.locator('[role="dialog"]').filter({ hasText: /getting started/i });
    if (await drawer2.isVisible({ timeout: 2000 })) {
      await page.keyboard.press('Escape');
    }
  } catch {}
  await sleep(1000);

  // Wait for app to load and settle
  await page.waitForURL('**/*', { timeout: 15000 }).catch(() => {});
  await sleep(5000);

  // Inject supabase client from the running app, then set up staff role
  await page.evaluate(async () => {
    // Wait for supabase to be available
    let supabase;
    for (let i = 0; i < 20; i++) {
      try {
        const mod = await import('/src/integrations/supabase/client');
        supabase = mod.supabase;
        if (supabase) break;
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 500));
    }
    if (!supabase) throw new Error('Could not load supabase client');

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No authenticated user');

    const { data: ur } = await supabase
      .from('user_restaurants')
      .select('restaurant_id')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (!ur) throw new Error('No restaurant found');

    const rid = ur.restaurant_id;

    // Set subscription to pro
    await supabase.from('restaurants')
      .update({ subscription_tier: 'pro', subscription_status: 'active' })
      .eq('id', rid);

    // Create employee linked to this user
    await supabase.from('employees').insert({
      restaurant_id: rid,
      name: 'Maria Rodriguez',
      position: 'Server',
      hourly_rate: 1600,
      status: 'active',
      user_id: user.id,
    });

    // Create some shifts for demo
    const today = new Date();
    const shifts = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(today);
      date.setDate(today.getDate() - 3 + d);
      const ds = date.toISOString().slice(0, 10);
      const { data: emp } = await supabase.from('employees').select('id').eq('restaurant_id', rid).limit(1).single();
      shifts.push({
        restaurant_id: rid,
        employee_id: emp.id,
        position: 'Server',
        start_time: `${ds}T09:00:00-05:00`,
        end_time: `${ds}T17:00:00-05:00`,
        break_duration: 30,
        status: d < 3 ? 'completed' : 'scheduled',
      });
    }
    await supabase.from('shifts').insert(shifts);

    // Create time punches for past days
    const { data: emp } = await supabase.from('employees').select('id').eq('restaurant_id', rid).limit(1).single();
    const punches = [];
    for (let d = 1; d <= 3; d++) {
      const date = new Date(today);
      date.setDate(today.getDate() - d);
      const ds = date.toISOString().slice(0, 10);
      punches.push(
        { id: crypto.randomUUID(), restaurant_id: rid, employee_id: emp.id, punch_type: 'clock_in', punch_time: `${ds}T09:02:00-05:00`, created_at: `${ds}T09:02:00-05:00`, updated_at: `${ds}T09:02:00-05:00` },
        { id: crypto.randomUUID(), restaurant_id: rid, employee_id: emp.id, punch_type: 'clock_out', punch_time: `${ds}T17:05:00-05:00`, created_at: `${ds}T17:05:00-05:00`, updated_at: `${ds}T17:05:00-05:00` },
      );
    }
    await supabase.from('time_punches').insert(punches);

    // Set role to staff
    await supabase
      .from('user_restaurants')
      .update({ role: 'staff' })
      .eq('restaurant_id', rid)
      .eq('user_id', user.id);
  });

  // Save state and reload to pick up staff role
  const stateFile = path.join(DIR, 'auth-help.json');
  await ctx1.storageState({ path: stateFile });
  await page.close();
  await ctx1.close();
  console.log('  Logged in and set to staff role.\n');

  // Step 2: Record each employee page (mobile viewport)
  const clips = [
    { name: 'welcome',  url: '/employee/schedule', scroll: false },
    { name: 'clock',    url: '/employee/clock',    scroll: false },
    { name: 'schedule', url: '/employee/schedule',  scroll: 300 },
    { name: 'pay',      url: '/employee/pay',      scroll: false },
    { name: 'timecard', url: '/employee/timecard',  scroll: false },
    { name: 'tips',     url: '/employee/tips',      scroll: false },
    { name: 'shifts',   url: '/employee/shifts',    scroll: false },
    { name: 'requests', url: '/employee/portal',    scroll: false },
  ];

  for (const clip of clips) {
    const audioFile = path.join(AUDIO_DIR, `${clip.name}.wav`);
    if (!fs.existsSync(audioFile)) {
      console.log(`Skipping ${clip.name} — no audio file`);
      continue;
    }
    const dur = getDuration(audioFile);
    const totalMs = Math.ceil(dur * 1000) + 2000;
    console.log(`Recording ${clip.name} (${dur.toFixed(1)}s)...`);

    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: stateFile,
      recordVideo: { dir: CLIPS_DIR, size: { width: 390, height: 844 } },
    });
    const p = await ctx.newPage();
    await p.goto(`${BASE_URL}${clip.url}`, { waitUntil: 'networkidle' });
    await sleep(3000);

    if (typeof clip.scroll === 'number' && clip.scroll > 0) {
      await sleep(1500);
      await p.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), clip.scroll);
    }

    await sleep(totalMs - 3000);

    const video = p.video();
    await p.close();
    await ctx.close();
    if (video) {
      const vp = await video.path();
      fs.renameSync(vp, path.join(CLIPS_DIR, `${clip.name}.webm`));
    }
    console.log(`  Done.`);
  }

  // Restore role back to owner
  console.log('\nRestoring owner role...');
  const ctx2 = await browser.newContext({ storageState: stateFile, viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE_URL);
  await sleep(2000);
  await p2.waitForURL('**/*', { timeout: 10000 }).catch(() => {});
  await sleep(3000);
  await p2.evaluate(async () => {
    const { supabase } = await import('/src/integrations/supabase/client');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: ur } = await supabase
      .from('user_restaurants')
      .select('restaurant_id')
      .eq('user_id', user.id)
      .limit(1)
      .single();
    if (!ur) return;
    await supabase
      .from('user_restaurants')
      .update({ role: 'owner' })
      .eq('restaurant_id', ur.restaurant_id)
      .eq('user_id', user.id);
  });
  await p2.close();
  await ctx2.close();

  fs.unlinkSync(stateFile);
  await browser.close();
  console.log('All clips recorded!');
})();
