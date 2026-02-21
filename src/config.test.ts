import { describe, it, expect, vi } from 'vitest';
import { ConfigValidationError, loadConfig, loadSoulPromptWithDeps } from './config.js';

describe('loadSoulPromptWithDeps', () => {
  it('deve carregar arquivo SOUL.md do caminho explicito quando existe', async () => {
    const readFile = vi.fn().mockResolvedValue('# SOUL\nConteúdo do SOUL');
    const result = await loadSoulPromptWithDeps(
      readFile,
      '/project',
      '/custom/path/SOUL.md'
    );

    expect(result.prompt).toContain('Conteúdo do SOUL');
    expect(result.source).toBe('/custom/path/SOUL.md');
    expect(readFile).toHaveBeenCalledWith('/custom/path/SOUL.md');
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('deve tentar caminhos alternativos quando explicito não existe', async () => {
    const readFile = vi.fn()
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValue('# SOUL\nConteúdo');
    
    const result = await loadSoulPromptWithDeps(
      readFile,
      '/project',
      '/custom/path/SOUL.md'
    );

    expect(result.source).toBe('/project/docs/core/SOUL.md');
    expect(result.prompt).toContain('Conteúdo');
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it('deve carregar de docs/core/SOUL.md quando existe', async () => {
    const readFile = vi.fn().mockResolvedValue('# SOUL\nConteúdo');
    const result = await loadSoulPromptWithDeps(
      readFile,
      '/project'
    );

    expect(result.source).toBe('/project/docs/core/SOUL.md');
    expect(result.prompt).toContain('Conteúdo');
  });

  it('deve tentar SOUL.md na raiz quando docs/core/SOUL.md não existe', async () => {
    const readFile = vi.fn()
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValue('# SOUL\nConteúdo');
    
    const result = await loadSoulPromptWithDeps(
      readFile,
      '/project'
    );

    expect(result.source).toBe('/project/SOUL.md');
    expect(result.prompt).toContain('Conteúdo');
  });

  it('deve retornar prompt padrão quando nenhum arquivo SOUL.md existe', async () => {
    const readFile = vi.fn().mockRejectedValue(new Error('not found'));
    const result = await loadSoulPromptWithDeps(
      readFile,
      '/project'
    );

    expect(result.source).toBeUndefined();
    expect(result.prompt).toContain('super agente local de video e automacao');
    expect(result.prompt).not.toContain('SOUL.md');
  });

  it('deve ignorar arquivo SOUL.md vazio', async () => {
    const readFile = vi.fn()
      .mockResolvedValueOnce('   ')
      .mockResolvedValue('# SOUL\nConteúdo');
    
    const result = await loadSoulPromptWithDeps(
      readFile,
      '/project'
    );

    expect(result.source).toBe('/project/SOUL.md');
    expect(result.prompt).toContain('Conteúdo');
  });

  it('deve ignorar arquivo SOUL.md com apenas whitespace', async () => {
    const readFile = vi.fn()
      .mockResolvedValueOnce('\n\n  \n\t\n')
      .mockResolvedValue('# SOUL\nConteúdo');
    
    const result = await loadSoulPromptWithDeps(
      readFile,
      '/project'
    );

    expect(result.source).toBe('/project/SOUL.md');
    expect(result.prompt).toContain('Conteúdo');
  });

  it('deve combinar prompt padrão com conteúdo do SOUL.md', async () => {
    const readFile = vi.fn().mockResolvedValue('# SOUL\nSeja útil e conciso');
    const result = await loadSoulPromptWithDeps(
      readFile,
      '/project'
    );

    expect(result.prompt).toContain('super agente local de video e automacao');
    expect(result.prompt).toContain('A identidade do Kael e definida pelo arquivo SOUL.md abaixo');
    expect(result.prompt).toContain('Seja útil e conciso');
  });

  it('deve trim conteúdo do arquivo SOUL.md', async () => {
    const readFile = vi.fn().mockResolvedValue('  \n# SOUL\nConteúdo  \n  ');
    const result = await loadSoulPromptWithDeps(
      readFile,
      '/project'
    );

    expect(result.prompt).not.toContain('  \n# SOUL\nConteúdo  \n  ');
    expect(result.prompt).toContain('# SOUL\nConteúdo');
  });

  it('deve usar prompt padrão quando explicitPath é undefined', async () => {
    const readFile = vi.fn().mockResolvedValue('# SOUL\nConteúdo');
    const result = await loadSoulPromptWithDeps(
      readFile,
      '/project',
      undefined
    );

    expect(result.source).toBe('/project/docs/core/SOUL.md');
  });

  it('deve usar prompt padrão quando explicitPath é null', async () => {
    const readFile = vi.fn().mockResolvedValue('# SOUL\nConteúdo');
    const result = await loadSoulPromptWithDeps(
      readFile,
      '/project',
      null as unknown as undefined
    );

    expect(result.source).toBe('/project/docs/core/SOUL.md');
  });

  it('deve ignorar erro ao ler arquivo e tentar próximo candidato', async () => {
    const readFile = vi.fn()
      .mockRejectedValueOnce(new Error('error 1'))
      .mockRejectedValueOnce(new Error('error 2'))
      .mockResolvedValue('# SOUL\nConteúdo');
    
    const result = await loadSoulPromptWithDeps(
      readFile,
      '/project',
      '/custom/path/SOUL.md'
    );

    expect(result.source).toBe('/project/SOUL.md');
    expect(readFile).toHaveBeenCalledTimes(3);
  });

  it('deve lidar com conteúdo longo do SOUL.md', async () => {
    const longContent = '# SOUL\n' + 'Line\n'.repeat(100) + 'End';
    const readFile = vi.fn().mockResolvedValue(longContent);
    const result = await loadSoulPromptWithDeps(
      readFile,
      '/project'
    );

    expect(result.prompt).toContain(longContent);
    expect(result.source).toBe('/project/docs/core/SOUL.md');
  });

  it('deve preservar newlines e formatação do SOUL.md', async () => {
    const content = '# SOUL\n\n## Regra 1\n\nSeja conciso.\n\n## Regra 2\n\nSeja técnico.';
    const readFile = vi.fn().mockResolvedValue(content);
    const result = await loadSoulPromptWithDeps(
      readFile,
      '/project'
    );

    expect(result.prompt).toContain(content);
  });

  it('deve retornar source correto quando usa caminho explicito', async () => {
    const readFile = vi.fn().mockResolvedValue('# SOUL\nConteúdo');
    const result = await loadSoulPromptWithDeps(
      readFile,
      '/project',
      '/absolute/path/to/SOUL.md'
    );

    expect(result.source).toBe('/absolute/path/to/SOUL.md');
  });

  it('deve parar de tentar candidatos quando encontra válido', async () => {
    const readFile = vi.fn().mockResolvedValue('# SOUL\nConteúdo');
    const result = await loadSoulPromptWithDeps(
      readFile,
      '/project'
    );

    expect(readFile).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('/project/docs/core/SOUL.md');
  });
});

describe('loadConfig validation', () => {
  it('deve falhar quando engineMode=pi sem api key', async () => {
    const previousMode = process.env.KAEL_ENGINE_MODE;
    const previousKey = process.env.KAEL_PI_API_KEY;
    try {
      process.env.KAEL_ENGINE_MODE = 'pi';
      process.env.KAEL_PI_API_KEY = '   ';
      await expect(loadConfig('/tmp/kael-config-test')).rejects.toBeInstanceOf(ConfigValidationError);
    } finally {
      if (previousMode === undefined) {
        delete process.env.KAEL_ENGINE_MODE;
      } else {
        process.env.KAEL_ENGINE_MODE = previousMode;
      }
      if (previousKey === undefined) {
        delete process.env.KAEL_PI_API_KEY;
      } else {
        process.env.KAEL_PI_API_KEY = previousKey;
      }
    }
  });

  it('deve falhar com engineMode invalido', async () => {
    const previousMode = process.env.KAEL_ENGINE_MODE;
    try {
      process.env.KAEL_ENGINE_MODE = 'invalid-mode';
      await expect(loadConfig('/tmp/kael-config-test')).rejects.toBeInstanceOf(ConfigValidationError);
    } finally {
      if (previousMode === undefined) {
        delete process.env.KAEL_ENGINE_MODE;
      } else {
        process.env.KAEL_ENGINE_MODE = previousMode;
      }
    }
  });

  it('deve falhar quando research habilitado sem api key', async () => {
    const prevEnabled = process.env.KAEL_RESEARCH_ENABLED;
    const prevKey = process.env.KAEL_RESEARCH_API_KEY;
    try {
      process.env.KAEL_RESEARCH_ENABLED = 'true';
      process.env.KAEL_RESEARCH_API_KEY = ' ';
      await expect(loadConfig('/tmp/kael-config-test')).rejects.toBeInstanceOf(ConfigValidationError);
    } finally {
      if (prevEnabled === undefined) {
        delete process.env.KAEL_RESEARCH_ENABLED;
      } else {
        process.env.KAEL_RESEARCH_ENABLED = prevEnabled;
      }
      if (prevKey === undefined) {
        delete process.env.KAEL_RESEARCH_API_KEY;
      } else {
        process.env.KAEL_RESEARCH_API_KEY = prevKey;
      }
    }
  });
});
