import { chromium } from 'playwright';
import { mkdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const duration = Math.max(20, Math.min(90, Number(process.env.DURATION) || 45));
const width = 1920, height = 1080, fps = 30;
const url = 'https://aldo200908-lgtm.github.io/sushi-ten-bento-/';
const output = 'output/sushi-ten-bento-cinematico.mp4';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

await mkdir('output', { recursive: true });
const browser = await chromium.launch({
  headless: false,
  args: [
    '--kiosk', '--window-position=0,0', '--window-size=1920,1080',
    '--autoplay-policy=no-user-gesture-required', '--disable-infobars',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding'
  ]
});
let recorder;
try {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1,
    reducedMotion: 'no-preference'
  });
  const page = await context.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('Browser:', msg.text().slice(0, 180));
  });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const img of document.images) if (img.loading === 'lazy') img.loading = 'eager';
    document.documentElement.style.scrollBehavior = 'auto';
  });
  // Recording-only preview: keep the actual public catalog unchanged.
  // Show only four cards so the film reaches the gallery quickly and naturally.
  await page.addStyleTag({content: `
    .experience-card:nth-child(n+5){display:none!important}
    .experience-grid{align-content:start!important}
  `});
  await page.waitForTimeout(2500);

  const visibleCards = await page.locator('.experience-card:visible').count();
  console.log('Catalog cards visible in recording:', visibleCards);
  const total = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - innerHeight));
  console.log('Real-time recording:', duration, 'seconds, scroll distance:', total, 'px');

  recorder = spawn('ffmpeg', [
    '-y', '-f', 'x11grab', '-framerate', String(fps),
    '-video_size', width + 'x' + height,
    '-i', process.env.DISPLAY || ':99',
    '-t', String(duration),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let ffLog = '';
  recorder.stderr.on('data', chunk => { ffLog = (ffLog + chunk.toString()).slice(-4000); });
  const finished = new Promise((resolve, reject) => {
    recorder.on('error', reject);
    recorder.on('close', code => code === 0 ? resolve() : reject(new Error('FFmpeg failed: ' + ffLog)));
  });

  // Scroll is driven by wall-clock time, not by screenshot throughput.
  // Thus background video and GSAP run at their original speed.
  await page.evaluate(async ({ total, duration }) => {
    const lead = 2.5, tail = 2.5;
    const start = performance.now();
    await new Promise(resolve => {
      const tick = now => {
        const elapsed = (now - start) / 1000;
        const p = Math.max(0, Math.min(1, (elapsed - lead) / (duration - lead - tail)));
        const eased = p * p * (3 - 2 * p);
        window.scrollTo({ top: total * eased, behavior: 'instant' });
        if (elapsed < duration) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }, { total, duration });

  await finished;
  const file = await stat(output);
  if (file.size < 100000) throw new Error('Recorded file is unexpectedly small');
  console.log('MP4 ready:', output, file.size, 'bytes');
} finally {
  if (recorder && recorder.exitCode === null) recorder.kill('SIGINT');
  await browser.close();
}
