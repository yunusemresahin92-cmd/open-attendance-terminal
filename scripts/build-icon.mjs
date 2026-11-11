import { writeFile } from 'node:fs/promises';
import pngToIco from 'png-to-ico';
const generated = await pngToIco('app-icon.png');
await writeFile('build/icon.ico', generated);
