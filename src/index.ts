import { walkFiles } from './walker.ts';

async function main(): Promise<void> {
  const cwd = process.cwd();
  console.log(`walking files in: ${cwd}`);
  const files = await walkFiles(cwd);
  for (const file of files) {
    console.log('file: ', file);
  }
  console.log(`Total files: ${files.length}`);
}

main();
