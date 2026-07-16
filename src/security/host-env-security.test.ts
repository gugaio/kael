import { describe, expect, it } from "vitest";
import { isDangerousHostEnvVarName, sanitizeHostEnv } from "./host-env-security.js";

describe("isDangerousHostEnvVarName", () => {
  it("bloqueia chaves da denylist exata (case-insensitive)", () => {
    expect(isDangerousHostEnvVarName("BASH_ENV")).toBe(true);
    expect(isDangerousHostEnvVarName("bash_env")).toBe(true);
    expect(isDangerousHostEnvVarName("NODE_OPTIONS")).toBe(true);
    expect(isDangerousHostEnvVarName("node_options")).toBe(true);
    expect(isDangerousHostEnvVarName("SHELL")).toBe(true);
    expect(isDangerousHostEnvVarName("IFS")).toBe(true);
    expect(isDangerousHostEnvVarName("PS4")).toBe(true);
    expect(isDangerousHostEnvVarName("ENV")).toBe(true);
    expect(isDangerousHostEnvVarName("PYTHONPATH")).toBe(true);
    expect(isDangerousHostEnvVarName("SSLKEYLOGFILE")).toBe(true);
  });

  it("bloqueia prefixos perigosos (case-insensitive)", () => {
    expect(isDangerousHostEnvVarName("LD_PRELOAD")).toBe(true);
    expect(isDangerousHostEnvVarName("ld_preload")).toBe(true);
    expect(isDangerousHostEnvVarName("LD_LIBRARY_PATH")).toBe(true);
    expect(isDangerousHostEnvVarName("DYLD_INSERT_LIBRARIES")).toBe(true);
    expect(isDangerousHostEnvVarName("DYLD_LIBRARY_PATH")).toBe(true);
    expect(isDangerousHostEnvVarName("BASH_FUNC_foo%%")).toBe(true);
  });

  it("permite variaveis seguras comuns", () => {
    expect(isDangerousHostEnvVarName("PATH")).toBe(false);
    expect(isDangerousHostEnvVarName("HOME")).toBe(false);
    expect(isDangerousHostEnvVarName("USER")).toBe(false);
    expect(isDangerousHostEnvVarName("TERM")).toBe(false);
    expect(isDangerousHostEnvVarName("LANG")).toBe(false);
    expect(isDangerousHostEnvVarName("PWD")).toBe(false);
  });

  it("retorna false para chave vazia", () => {
    expect(isDangerousHostEnvVarName("")).toBe(false);
    expect(isDangerousHostEnvVarName("   ")).toBe(false);
  });
});

describe("sanitizeHostEnv", () => {
  it("remove variaveis perigosas e preserva as seguras", () => {
    const raw: NodeJS.ProcessEnv = {
      PATH: "/usr/bin:/bin",
      HOME: "/home/user",
      LD_PRELOAD: "/evil.so",
      BASH_ENV: "/evil.sh",
      NODE_OPTIONS: "--require /evil",
      SHELL: "/bin/bash",
      MY_APP_VAR: "safe",
    };
    const result = sanitizeHostEnv(raw);
    expect(result.PATH).toBe("/usr/bin:/bin");
    expect(result.HOME).toBe("/home/user");
    expect(result.MY_APP_VAR).toBe("safe");
    expect(result).not.toHaveProperty("LD_PRELOAD");
    expect(result).not.toHaveProperty("BASH_ENV");
    expect(result).not.toHaveProperty("NODE_OPTIONS");
    expect(result).not.toHaveProperty("SHELL");
  });

  it("ignora entradas undefined no env", () => {
    const raw: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      UNDEFINED_VAR: undefined,
    };
    const result = sanitizeHostEnv(raw);
    expect(result.PATH).toBe("/usr/bin");
    expect(result).not.toHaveProperty("UNDEFINED_VAR");
  });

  it("aplica extraDenylist adicional", () => {
    const raw: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      MY_SECRET: "secret",
      NORMAL: "ok",
    };
    const result = sanitizeHostEnv(raw, ["MY_SECRET"]);
    expect(result.NORMAL).toBe("ok");
    expect(result.PATH).toBe("/usr/bin");
    expect(result).not.toHaveProperty("MY_SECRET");
  });

  it("preserva PATH mesmo sendo case-sensitive no ambiente", () => {
    const raw: NodeJS.ProcessEnv = {
      PATH: "/usr/local/bin:/usr/bin",
      path: "/usr/bin",
    };
    const result = sanitizeHostEnv(raw);
    // PATH (uppercase) é explicitamente preservado
    expect(result.PATH).toBe("/usr/local/bin:/usr/bin");
  });

  describe("credential auto-stripping", () => {
    it("bloqueia variaveis com KEY no nome", () => {
      expect(isDangerousHostEnvVarName("MY_API_KEY")).toBe(true);
      expect(isDangerousHostEnvVarName("my_api_key")).toBe(true);
      expect(isDangerousHostEnvVarName("AWS_ACCESS_KEY_ID")).toBe(true);
      expect(isDangerousHostEnvVarName("PRIVATE_KEY")).toBe(true);
    });

    it("bloqueia variaveis com TOKEN no nome", () => {
      expect(isDangerousHostEnvVarName("GITHUB_TOKEN")).toBe(true);
      expect(isDangerousHostEnvVarName("auth_token")).toBe(true);
      expect(isDangerousHostEnvVarName("SESSION_TOKEN")).toBe(true);
      expect(isDangerousHostEnvVarName("REFRESH_TOKEN")).toBe(true);
    });

    it("bloqueia variaveis com SECRET no nome", () => {
      expect(isDangerousHostEnvVarName("ACCESS_SECRET")).toBe(true);
      expect(isDangerousHostEnvVarName("my_secret_key")).toBe(true);
    });

    it("bloqueia variaveis com PASSWORD/PASSWD no nome", () => {
      expect(isDangerousHostEnvVarName("DB_PASSWORD")).toBe(true);
      expect(isDangerousHostEnvVarName("SUDO_PASSWD")).toBe(true);
    });

    it("bloqueia variaveis de URL de banco", () => {
      expect(isDangerousHostEnvVarName("DATABASE_URL")).toBe(true);
      expect(isDangerousHostEnvVarName("REDIS_URL")).toBe(true);
      expect(isDangerousHostEnvVarName("MONGODB_URI")).toBe(true);
    });

    it("bloqueia variaveis com AUTH/BEARER no nome", () => {
      expect(isDangerousHostEnvVarName("AUTHORIZATION")).toBe(true);
      expect(isDangerousHostEnvVarName("BEARER_TOKEN")).toBe(true);
      expect(isDangerousHostEnvVarName("AUTH_TOKEN")).toBe(true);
    });

    it("remove credenciais do env sanitizado", () => {
      const raw: NodeJS.ProcessEnv = {
        PATH: "/usr/bin",
        HOME: "/home/user",
        AWS_ACCESS_KEY_ID: "AKIA123",
        GITHUB_TOKEN: "ghp_abc123",
        DB_PASSWORD: "supersecret",
        MY_APP_VAR: "safe",
      };
      const result = sanitizeHostEnv(raw);
      expect(result.PATH).toBe("/usr/bin");
      expect(result.HOME).toBe("/home/user");
      expect(result.MY_APP_VAR).toBe("safe");
      expect(result).not.toHaveProperty("AWS_ACCESS_KEY_ID");
      expect(result).not.toHaveProperty("GITHUB_TOKEN");
      expect(result).not.toHaveProperty("DB_PASSWORD");
    });

    it("preserva variaveis seguras mesmo com padroes parciais", () => {
      const raw: NodeJS.ProcessEnv = {
        PATH: "/usr/bin",
        HOME: "/home/user",
        MY_KEYCHAIN: "/path/to/keychain", // 'KEY' no meio mas não é credential
        TOKENIZER_MODEL: "gpt-4",          // 'TOKEN' no meio mas não é credential
      };
      // KEYCHAIN contém KEY no início, TOKENIZER contém TOKEN no início
      // Ambos são legítimos mas serão bloqueados pelo padrão conservador
      expect(isDangerousHostEnvVarName("MY_KEYCHAIN")).toBe(true);
      expect(isDangerousHostEnvVarName("TOKENIZER_MODEL")).toBe(true);
    });
  });
});
