import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const PACKAGE_FILES = Object.freeze([
  'manifest.json',
  'background.js',
  'review.html',
  'review.css',
  'review.js',
  'domain.js',
  'store.js',
  'removal.js',
  'reminders.js',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png'
]);

export const TRANSFORMED_RUNTIME_FILES = Object.freeze([
  'manifest.json',
  'review.html',
  'review.js',
  'reminders.js'
]);

const TEXT_RUNTIME_FILES = new Set(PACKAGE_FILES.filter(file => !file.endsWith('.png')));

export function replaceExactlyOnce(source, anchor, replacement, label) {
  if (typeof source !== 'string') throw new TypeError(`${label} source must be a string.`);
  const parts = source.split(anchor);
  if (parts.length === 1) throw new Error(`${label} anchor was not found exactly as expected.`);
  if (parts.length !== 2) throw new Error(`${label} anchor appeared more than once; source drift must be reviewed.`);
  return `${parts[0]}${replacement}${parts[1]}`;
}

function requireSource(sources, relativePath) {
  if (typeof sources?.[relativePath] !== 'string') throw new Error(`Missing text source: ${relativePath}`);
  return sources[relativePath];
}

export function transformManifest(source) {
  source = source.replace(/\r\n/g, '\n');
  const { version } = JSON.parse(source);
  if(typeof version!=='string' || !/^\d+(?:\.\d+){0,3}$/.test(version))throw new Error('Invalid test-build source version.');
  let next = replaceExactlyOnce(
    source,
    '  "name": "Backburner",',
    `  "name": "Backburner Notification Test — NOT FOR PUBLICATION",\n  "version_name": "${version}-notification-test",`,
    'manifest name'
  );
  next = replaceExactlyOnce(
    next,
    '  "minimum_chrome_version": "114",',
    '  "minimum_chrome_version": "120",',
    'manifest chrome floor'
  );
  return next;
}

export function transformReminders(source) {
  source = source.replace(/\r\n/g, '\n');
  let next = replaceExactlyOnce(
    source,
    'export const WEEK = 7 * 86400000;',
    'export const WEEK = 30000;',
    'weekly reminder cadence'
  );
  next = replaceExactlyOnce(
    next,
    'const RETRY = 3600000;',
    'const RETRY = 30000;\nconst UNANSWERED_COOLDOWN = 30000;',
    'retry cadence'
  );
  next = replaceExactlyOnce(
    next,
    `export function deliveryWindow(at) {
  const date = new Date(at);
  if (date.getHours() < 9) date.setHours(9, 0, 0, 0);
  else if (date.getHours() >= 18) {
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
  }
  return date.getTime();
}
`,
    `export function deliveryWindow(at) {
  return at;
}
`,
    'delivery window'
  );
  next = replaceExactlyOnce(
    next,
    'offer.at + LATER_DELAY',
    'offer.at + UNANSWERED_COOLDOWN',
    'ignored reminder cooldown'
  );
  next = replaceExactlyOnce(
    next,
    "title: 'Backburner',",
    "title: 'Backburner TEST ONLY — NOT FOR PUBLICATION',",
    'notification title'
  );
  return next;
}

export function transformReviewHtml(source) {
  source = source.replace(/\r\n/g, '\n');
  let next = replaceExactlyOnce(
    source,
    '<main id="main" tabindex="-1">',
    `<main id="main" tabindex="-1">
    <section id="notification-test-banner" class="notice" role="status" aria-live="polite">
      <p class="eyebrow">TEST BUILD ONLY · NOT FOR PUBLICATION</p>
      <h2>Native notification cadence is overridden to 30 seconds in this artifact only.</h2>
      <p>Quiet reminders can first appear after 30 seconds, an unanswered eligible bookmark can be offered again after 30 seconds, and a visible-review retry waits 30 seconds. Chrome or your operating system can still delay or suppress native delivery.</p>
      <p>Later still waits 14 days, Keep still waits 365 days, and Stop still has no expiry. Enable optional reminders, then close or background this review page, capture native notification/click evidence, and disable this test extension afterward.</p>
    </section>`,
    'review banner'
  );
  next = replaceExactlyOnce(
    next,
    '      <p class="trust-note">Want a bookmark to come back without remembering to open Backburner?<br>Optional quiet notifications: at most once per 7 days, starting after one week. No titles or URLs in notifications.</p>',
    '      <p class="trust-note">Want a bookmark to come back without remembering to open Backburner?<br>Optional quiet notifications: at most once every 30 seconds, starting after 30 seconds in this test build. No titles or URLs in notifications.</p>',
    'welcome reminder copy'
  );
  next = replaceExactlyOnce(
    next,
    '        <p class="small-note">One notification at most every 7 elapsed days, only when something is eligible, between 09:00 and 18:00 local time. First opportunity is after one week. Later waits at least 14 elapsed days, then shares future reminder slots. These are initial product policies, not measured optima.</p>',
    '        <p class="small-note">One notification at most every 30 elapsed seconds, only when something is eligible, at any local hour in this test build. First opportunity is after 30 seconds. Later waits at least 14 elapsed days, then shares future reminder slots. These are initial test-build policies for native notification evidence, not measured optima.</p>',
    'help reminder schedule copy'
  );
  next = replaceExactlyOnce(
    next,
    'that item waits at least 14 days before another offer.',
    'in this test build, that item waits at least 30 seconds before another offer.',
    'ignored reminder help copy'
  );
  return next;
}

export function transformReviewJs(source) {
  source = source.replace(/\r\n/g, '\n');
  let next = replaceExactlyOnce(
    source,
    "  if(snapshot.status==='error' || snapshot.status==='uncertain')return reminderStatus('Reminder delivery could not be confirmed. No extra notification will bypass the weekly limit. Your saved decisions and recovery copies are kept.');",
    "  if(snapshot.status==='error' || snapshot.status==='uncertain')return reminderStatus('Reminder delivery could not be confirmed. No extra notification will bypass the 30-second test-build limit. Your saved decisions and recovery copies are kept.');",
    'review status error copy'
  );
  next = replaceExactlyOnce(
    next,
    "  reminderStatus(`Quiet reminders enabled: at most once per 7 days, between 09:00 and 18:00. Chrome or your operating system may delay or suppress them.${next}`);",
    "  reminderStatus(`Quiet reminders enabled: at most once every 30 seconds, at any hour in this test build. Chrome or your operating system may delay or suppress them.${next}`);",
    'review status schedule copy'
  );
  return next;
}

export function transformNotificationTestSources(sources) {
  const next = { ...sources };
  next['manifest.json'] = transformManifest(requireSource(sources, 'manifest.json'));
  next['review.html'] = transformReviewHtml(requireSource(sources, 'review.html'));
  next['review.js'] = transformReviewJs(requireSource(sources, 'review.js'));
  next['reminders.js'] = transformReminders(requireSource(sources, 'reminders.js'));
  return next;
}

async function listRelativeFiles(root) {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async entry => {
      const target = path.join(root, entry.name);
      if(entry.isSymbolicLink())throw new Error(`Linked notification-test output is not allowed: ${target}`);
      if (entry.isDirectory()) return listRelativeFiles(target).then(files => files.map(file => path.join(entry.name, file)));
      return [entry.name];
    }));
    return nested.flat();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function buildNotificationTest({ sourceRoot, outputRoot } = {}) {
  const packageFiles=PACKAGE_FILES;
  const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
  const resolvedSourceRoot = path.resolve(sourceRoot ?? path.join(scriptRoot, '..'));
  const resolvedOutputRoot = path.resolve(outputRoot ?? path.join(resolvedSourceRoot, 'dist', 'notification-test', 'unpacked'));
  const testRoot=path.join(resolvedSourceRoot,'dist','notification-test');
  const relativeOutput=path.relative(testRoot,resolvedOutputRoot);
  if(!relativeOutput || relativeOutput==='..' || relativeOutput.startsWith(`..${path.sep}`) || path.isAbsolute(relativeOutput)) {
    throw new Error('Notification-test output must be a subdirectory of dist/notification-test.');
  }
  for(let current=resolvedOutputRoot;path.relative(resolvedSourceRoot,current);current=path.dirname(current)) {
    const stats=await fs.lstat(current).catch(error=>{
      if(error.code==='ENOENT')return null;
      throw error;
    });
    if(stats?.isSymbolicLink())throw new Error(`Linked notification-test output is not allowed: ${current}`);
  }
  const allowed = new Set(packageFiles.map(file => file.replace(/\\/g, '/')));
  const existing = await listRelativeFiles(resolvedOutputRoot);
  for (const relative of existing.map(file => file.replace(/\\/g, '/'))) {
    if (!allowed.has(relative)) throw new Error(`Unexpected notification-test artifact file: ${relative}`);
  }

  const textSources = {};
  for (const relativePath of packageFiles) {
    const sourcePath = path.join(resolvedSourceRoot, relativePath);
    const stats = await fs.stat(sourcePath);
    if (!stats.isFile()) throw new Error(`Missing package file: ${relativePath}`);
    if (TEXT_RUNTIME_FILES.has(relativePath)) textSources[relativePath] = await fs.readFile(sourcePath, 'utf8');
  }

  const transformed = transformNotificationTestSources(textSources);
  await fs.mkdir(resolvedOutputRoot, { recursive: true });
  for (const relativePath of packageFiles) {
    const targetPath = path.join(resolvedOutputRoot, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    // Replace only the named generated file, without writing through a hard link.
    await fs.rm(targetPath,{force:true});
    if (TEXT_RUNTIME_FILES.has(relativePath)) await fs.writeFile(targetPath, transformed[relativePath] ?? textSources[relativePath], 'utf8');
    else await fs.copyFile(path.join(resolvedSourceRoot, relativePath), targetPath);
  }

  return {
    outputRoot: resolvedOutputRoot,
    packageFiles: [...packageFiles],
    transformedFiles: [...TRANSFORMED_RUNTIME_FILES],
    marker: 'NOT FOR PUBLICATION'
  };
}

async function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write('Usage: node scripts/notification-test.mjs [--source-root <dir>] [--output-root <dir>]\n');
    return;
  }
  const options={};
  for(let i=0;i<args.length;i+=2) {
    const name=args[i],value=args[i+1];
    if(!['--source-root','--output-root'].includes(name) || !value || value.startsWith('--') || Object.hasOwn(options,name)) {
      throw new Error('Expected distinct --source-root/--output-root options with directory values.');
    }
    options[name]=value;
  }
  const result = await buildNotificationTest({
    sourceRoot: options['--source-root'],
    outputRoot: options['--output-root']
  });
  process.stdout.write(`PASS: generated ${result.packageFiles.length} notification-test runtime files in ${result.outputRoot}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
