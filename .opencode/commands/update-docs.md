# update-docs

## Descrição

Atualiza a documentação de arquitetura (`docs/arquitetura-geral.md`) com base nas mudanças em staging antes de fazer commit.

## Quando usar

Antes de commitar mudanças que afetam a arquitetura do sistema, como:

- Adicionar/remover aplicações ou pacotes
- Modificar dependências entre apps/packages
- Alterar fluxos de comunicação entre componentes
- Mudar responsabilidades de algum componente
- Adicionar novos endpoints, eventos ou tipos no protocolo

## Passos

1. **Identificar as mudanças**:
   ```bash
   git diff --name-only
   git diff --stat
   ```

2. **Analisar o impacto**:
   - Quais apps/packages foram modificados?
   - Foram adicionadas/removidas dependências?
   - A comunicação entre componentes mudou?
   - Novos tipos ou eventos foram adicionados ao protocolo?

3. **Atualizar o diagrama correspondente**:
   - **Diagrama de Arquitetura (Nível de Containers)**: Se mudou a estrutura de alto nível
   - **Diagrama de Componentes Detalhados**: Se mudou a comunicação entre componentes
   - **Diagrama de Dependências entre Packages**: Se mudou as dependências dos pacotes
   - **Diagrama de Fluxo de Análise Completa**: Se mudou o fluxo de dados
   - **Diagramas de Estrutura de Dados**: Se mudou os tipos de dados

4. **Atualizar as descrições**:
   - Atualizar propósitos se as responsabilidades mudaram
   - Adicionar/remover dependências nas listas
   - Atualizar responsabilidades de cada componente

5. **Verificar os diagramas**:
   - Certificar-se de que todos os diagramas Mermaid são válidos
   - Verificar se as conexões estão corretas (usando `-->` ou `.->`)
   - Garantir que os nomes dos nós estão entre aspas para evitar erros de parse

6. **Testar os diagramas** (opcional):
   - Copiar o código Mermaid para um visualizador online
   - Verificar se o diagrama é renderizado corretamente

## Checklist antes de commit

- [ ] Documentação atualizada refletindo todas as mudanças
- [ ] Todos os diagramas Mermaid são válidos
- [ ] Descrições de apps/packages estão atualizadas
- [ ] Dependências listadas estão corretas
- [ ] Fluxos de dados/sequência estão precisos
- [ ] Nenhum componente ou conexão ficou desatualizado

## Exemplo de atualização

### Cenário: Adicionou novo endpoint na API

1. Atualizar a seção **thesis-api**:
   - Adicionar novo endpoint em "Responsabilidades"
   
2. Se o endpoint afeta o fluxo de análise:
   - Atualizar o **Fluxo de Análise Completa** com novas chamadas
   
3. Se adicionou novo evento:
   - Adicionar à seção **Padrão de Comunicação**
   - Atualizar diagrama de fluxo se necessário

### Cenário: Adicionou novo pacote compartilhado

1. Adicionar entrada em **Pacotes Compartilhados**
2. Atualizar **Diagrama de Componentes Detalhados**
3. Atualizar **Dependências entre Packages**
4. Adicionar seção com propósito e conteúdo do novo pacote

## Arquivos envolvidos

- `docs/arquitetura-geral.md` - Documentação principal de arquitetura
- `docs/README.md` - Índice da documentação

## Comandos úteis

```bash
# Verificar mudanças na documentação
git diff docs/arquitetura-geral.md

# Verificar mudanças em package.jsons
git diff --name-only | grep package.json

# Listar apps modificados
git diff --name-only | grep apps/

# Listar packages modificados
git diff --name-only | grep packages/
```

## Notas

- Mantenha a consistência de formatação dos diagramas
- Use cores customizadas nos diagramas Mermaid para facilitar visualização
- Mantenha os diagramas simples e legíveis (evite excesso de detalhes)
- Atualize a data/versionamento se aplicável
