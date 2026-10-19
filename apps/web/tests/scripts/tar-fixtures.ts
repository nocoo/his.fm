import { gzipSync } from 'node:zlib';

function writeChecksum(header: Buffer): void {
  let sum = 0;
  for (let i = 0; i < 512; i++) {
    sum += header[i] ?? 0;
  }
  const checksum = `${sum.toString(8).padStart(6, '0')}\0 `;
  header.write(checksum, 148, 8, 'ascii');
}

type TarEntry = {
  name: string;
  content?: Buffer;
  typeflag?: string;
  linkname?: string;
};

function writeUstarHeader(entry: TarEntry): Buffer {
  const header = Buffer.alloc(512, 0);
  const content = entry.content ?? Buffer.alloc(0);
  const size = entry.typeflag === '1' || entry.typeflag === '2' ? 0 : content.length;
  header.write(entry.name.slice(0, 100), 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.write('        ', 148, 8, 'ascii');
  header.write(entry.typeflag ?? '0', 156, 1, 'ascii');
  if (entry.linkname) {
    header.write(entry.linkname.slice(0, 100), 157, 100, 'utf8');
  }
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  writeChecksum(header);
  return header;
}

function pad512(body: Buffer): Buffer {
  const remainder = body.length % 512;
  if (remainder === 0) {
    return body;
  }
  return Buffer.concat([body, Buffer.alloc(512 - remainder)]);
}

/** Build a gzip-compressed ustar archive without invoking the platform tar binary. */
export function buildGzipTarball(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const content = entry.content ?? Buffer.alloc(0);
    parts.push(writeUstarHeader(entry));
    const isLink = entry.typeflag === '1' || entry.typeflag === '2';
    if (!isLink) {
      parts.push(pad512(content));
    }
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

export function minimalSafePackageTarball(): Buffer {
  return buildGzipTarball([{ name: 'package/package.json', content: Buffer.from('{}') }]);
}

export function parentTraversalTarball(): Buffer {
  return buildGzipTarball([{ name: '../escape/payload.txt', content: Buffer.from('x') }]);
}

export function hardlinkEscapeTarball(): Buffer {
  return buildGzipTarball([
    { name: 'package/secret.txt', content: Buffer.from('secret') },
    {
      name: 'package/escape-link',
      typeflag: '1',
      linkname: 'package/secret.txt',
    },
  ]);
}
