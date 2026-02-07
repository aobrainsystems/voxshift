import fs from "node:fs/promises";

interface WavReadResult {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  samples: Int16Array;
}

function writeString(target: Buffer, offset: number, value: string): void {
  target.write(value, offset, "ascii");
}

export function pcm16ToWavBuffer(pcmData: Buffer, sampleRate: number, channels = 1): Buffer {
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmData.length;

  const header = Buffer.alloc(44);
  writeString(header, 0, "RIFF");
  header.writeUInt32LE(36 + dataSize, 4);
  writeString(header, 8, "WAVE");
  writeString(header, 12, "fmt ");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  writeString(header, 36, "data");
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

export async function writeWavFromPcm16(params: {
  outputPath: string;
  pcmData: Buffer;
  sampleRate: number;
  channels?: number;
}): Promise<void> {
  const wav = pcm16ToWavBuffer(params.pcmData, params.sampleRate, params.channels ?? 1);
  await fs.writeFile(params.outputPath, wav);
}

export async function readWavPcm16Mono(path: string): Promise<WavReadResult> {
  const data = await fs.readFile(path);
  if (data.length < 44) {
    throw new Error(`Invalid WAV file (too small): ${path}`);
  }

  const riff = data.toString("ascii", 0, 4);
  const wave = data.toString("ascii", 8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error(`Unsupported WAV header: ${path}`);
  }

  let offset = 12;
  let channels = 1;
  let sampleRate = 24000;
  let bitsPerSample = 16;
  let pcmOffset = -1;
  let pcmSize = 0;

  while (offset + 8 <= data.length) {
    const chunkId = data.toString("ascii", offset, offset + 4);
    const chunkSize = data.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;

    if (chunkId === "fmt ") {
      channels = data.readUInt16LE(chunkDataOffset + 2);
      sampleRate = data.readUInt32LE(chunkDataOffset + 4);
      bitsPerSample = data.readUInt16LE(chunkDataOffset + 14);
    }

    if (chunkId === "data") {
      pcmOffset = chunkDataOffset;
      pcmSize = chunkSize;
      break;
    }

    offset = chunkDataOffset + chunkSize;
  }

  if (pcmOffset < 0) {
    throw new Error(`WAV data chunk not found: ${path}`);
  }

  if (bitsPerSample !== 16) {
    throw new Error(`Only 16-bit PCM WAV is supported: ${path}`);
  }

  const pcm = data.subarray(pcmOffset, pcmOffset + pcmSize);
  if (channels === 1) {
    return {
      sampleRate,
      channels,
      bitsPerSample,
      samples: new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2),
    };
  }

  // Downmix multi-channel audio to mono by averaging channels.
  const totalFrames = pcm.length / 2 / channels;
  const source = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  const mono = new Int16Array(totalFrames);

  for (let frame = 0; frame < totalFrames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += source[frame * channels + channel];
    }
    mono[frame] = Math.max(-32768, Math.min(32767, Math.round(sum / channels)));
  }

  return {
    sampleRate,
    channels: 1,
    bitsPerSample,
    samples: mono,
  };
}

export async function writeWavPcm16Mono(path: string, sampleRate: number, samples: Int16Array): Promise<void> {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    pcm.writeInt16LE(samples[index], index * 2);
  }

  await writeWavFromPcm16({ outputPath: path, pcmData: pcm, sampleRate, channels: 1 });
}
