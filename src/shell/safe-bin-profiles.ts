import { unwrapCommand } from "./wrapper-resolution.js";

/**
 * Perfis de segurança para bins conhecidos.
 * Cada perfil define flags permitidas, flags bloqueadas,
 * e regras de validação de argumentos.
 */
export type BinProfile = {
  /** Aliases do binário (ex: python3, python). */
  names: string[];
  /** Flags POSIX permitidas (prefixo - ou --). */
  allowedFlags: string[];
  /** Flags explicitamente bloqueadas. */
  deniedFlags: string[];
  /** Se true, pipes com o output deste bin para outro são bloqueados. */
  blockPipesToShell?: boolean;
  /** Se true, redirect de output (> / >>) é bloqueado. */
  blockOutputRedirect?: boolean;
  /** Se true, o bin pode escrever em arquivos (-o, -O, etc). */
  canWriteFiles?: boolean;
  /** Caminhos permitidos para escrita (glob-like). */
  allowedWritePaths?: string[];
  /** Número máximo de argumentos posicionais. */
  maxPositionalArgs?: number;
};

const BUILTIN_PROFILES: BinProfile[] = [
  {
    names: ["curl", "wget"],
    allowedFlags: ["-s", "-S", "-f", "-L", "-o", "-O", "-C", "-H", "-A", "-X", "-d", "-b", "-c", "-k", "-i", "-I", "-v", "--connect-timeout", "--max-time", "--retry", "--retry-delay", "--retry-max-time", "--progress-bar", "--location", "--header", "--user-agent", "--data", "--data-urlencode", "--data-binary", "--cookie", "--cookie-jar", "--insecure", "--output", "--remote-name", "--continue-at", "--fail", "--silent", "--show-error"],
    deniedFlags: ["--exec", "-exec"],
    blockPipesToShell: true,
    canWriteFiles: true,
    allowedWritePaths: ["/tmp/**", "./**"],
    maxPositionalArgs: 2,
  },
  {
    names: ["ffmpeg", "ffprobe"],
    allowedFlags: ["-i", "-y", "-n", "-c:v", "-c:a", "-c:s", "-codec:v", "-codec:a", "-b:v", "-b:a", "-r", "-s", "-aspect", "-vf", "-af", "-filter:v", "-filter:a", "-t", "-to", "-ss", "-sn", "-dn", "-an", "-vn", "-map", "-metadata", "-f", "-movflags", "-pix_fmt", "-profile:v", "-preset", "-crf", "-maxrate", "-bufsize", "-g", "-keyint_min", "-sc_threshold", "-hls_time", "-hls_list_size", "-hls_segment_filename", "-hls_flags", "-start_number", "-progress", "-stats", "-loglevel", "-hide_banner", "-hwaccel", "-hwaccel_output_format", "-hwaccel_device", "-threads"],
    deniedFlags: [],
    blockPipesToShell: true,
    canWriteFiles: true,
    maxPositionalArgs: 2,
  },
  {
    names: ["git"],
    allowedFlags: ["-C", "--git-dir", "--work-tree", "-c"],
    deniedFlags: [],
    blockPipesToShell: false,
    maxPositionalArgs: 0,
  },
  {
    names: ["vlc"],
    allowedFlags: ["-I", "--intf", "--play-and-exit", "--fullscreen", "--no-video-title", "--rate", "--start-time", "--stop-time", "--no-qt-privacy-ask", "--no-qt-error-dialogs", "--verbose"],
    deniedFlags: [],
    blockPipesToShell: true,
  },
  {
    names: ["rsync"],
    allowedFlags: ["-a", "-v", "-z", "-P", "--progress", "-e", "--rsh", "--delete", "--exclude", "--include", "--bwlimit", "--timeout", "--partial", "--append", "--checksum"],
    deniedFlags: [],
    blockPipesToShell: true,
    maxPositionalArgs: 2,
  },
  {
    names: ["docker"],
    allowedFlags: [],
    deniedFlags: [],
    blockPipesToShell: true,
    maxPositionalArgs: 0,
  },
];

function findProfile(bin: string): BinProfile | undefined {
  const lower = bin.toLowerCase();
  return BUILTIN_PROFILES.find((p) => p.names.includes(lower));
}

export type ProfileValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Valida um comando contra o perfil de segurança do binário.
 * Retorna ok=true se o comando respeita o perfil, ou ok=false com motivo.
 */
export function validateCommandAgainstProfile(command: string): ProfileValidationResult {
  const unwrapped = unwrapCommand(command);
  const binName = unwrapped?.command ?? command.split(/\s+/)[0] ?? "";
  const cleanBin = binName.replace(/^['"]|['"]$/g, "").toLowerCase();
  const profile = findProfile(cleanBin);
  if (!profile) {
    return { ok: true }; // sem perfil = sem restrição adicional
  }

  const tokens = (unwrapped?.fullCommand ?? command).split(/\s+/);
  // Pula o binário
  const args = tokens.slice(1);

  // Conta argumentos posicionais (não-flag)
  let positionalCount = 0;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("-")) {
      // Pula flag com valor
      if (!arg.includes("=") && profile.allowedFlags.includes(arg) && i + 1 < args.length) {
        const next = args[i + 1];
        if (!next.startsWith("-")) {
          i++; // pula o valor
        }
      }
      // Verifica flag bloqueada
      if (profile.deniedFlags.some((f) => arg.startsWith(f))) {
        return { ok: false, reason: `flag bloqueada para ${cleanBin}: ${arg}` };
      }
      // Verifica flag permitida (se o perfil lista flags)
      if (profile.allowedFlags.length > 0) {
        const flagName = arg.includes("=") ? arg.split("=")[0] : arg;
        if (
          !flagName.startsWith("--") && flagName.length === 2
            ? profile.allowedFlags.includes(flagName)
            : profile.allowedFlags.includes(flagName) || profile.allowedFlags.includes(arg)
        ) {
          // flag permitida
        } else if (flagName.startsWith("-")) {
          return { ok: false, reason: `flag nao permitida para ${cleanBin}: ${flagName}` };
        }
      }
    } else {
      positionalCount++;
    }
  }

  if (profile.maxPositionalArgs !== undefined && positionalCount > profile.maxPositionalArgs) {
    return { ok: false, reason: `${cleanBin} aceita no maximo ${profile.maxPositionalArgs} argumentos posicionais, recebeu ${positionalCount}` };
  }

  // Verifica pipes para shell se bloqueado
  if (profile.blockPipesToShell) {
    const pipeSegments = command.split("|").slice(1);
    const shellBins = ["bash", "sh", "zsh", "dash", "ksh", "fish"];
    for (const segment of pipeSegments) {
      const firstToken = segment.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      if (shellBins.some((s) => firstToken === s || firstToken.includes(s))) {
        return { ok: false, reason: `${cleanBin} nao pode ter pipe para shell` };
      }
    }
  }

  return { ok: true };
}

/**
 * Retorna os bins seguros conhecidos (para exibir na allowlist).
 */
export function getKnownSafeBins(): string[] {
  return BUILTIN_PROFILES.flatMap((p) => p.names).sort();
}
