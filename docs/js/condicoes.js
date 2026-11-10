// condicoes.js — as condições do Livro do Jogador 2024, com um ícone e um resumo curto (com as nossas palavras).
export const CONDICOES = [
  ['agarrado', 'Agarrado', '✊', 'Deslocamento 0. Desvantagem nos ataques contra quem não seja quem agarrou. Pode ser movido junto.'],
  ['amedrontado', 'Amedrontado', '😱', 'Desvantagem em testes e ataques enquanto vê a fonte do medo. Não se aproxima dela por vontade própria.'],
  ['atordoado', 'Atordoado', '💫', 'Incapacitado. Falha em salvaguardas de Força e Destreza. Ataques contra ele têm vantagem.'],
  ['caido', 'Caído', '⬇', 'Só rasteja (ou gasta metade do deslocamento para levantar). Desvantagem nos ataques. Ataque a até 1,5 m tem vantagem; de longe, desvantagem.'],
  ['cego', 'Cego', '🙈', 'Não vê e falha em testes que dependem da visão. Desvantagem nos ataques; ataques contra ele têm vantagem.'],
  ['enfeiticado', 'Enfeitiçado', '💗', 'Não ataca quem o enfeitiçou. Quem enfeitiçou tem vantagem em testes sociais com ele.'],
  ['envenenado', 'Envenenado', '🤢', 'Desvantagem em ataques e testes de atributo.'],
  ['impedido', 'Impedido', '⛓', 'Deslocamento 0. Desvantagem nos ataques e em salvaguardas de Destreza. Ataques contra ele têm vantagem.'],
  ['incapacitado', 'Incapacitado', '✖', 'Não faz ações, ações bônus nem reações. Perde a Concentração, não fala e tem desvantagem na iniciativa.'],
  ['inconsciente', 'Inconsciente', '💤', 'Incapacitado e Caído. Larga o que segura. Falha em salvaguardas de Força e Destreza. Ataques contra ele têm vantagem; a até 1,5 m, acerto é crítico.'],
  ['invisivel', 'Invisível', '👻', 'Não pode ser visto sem magia. Vantagem na iniciativa e nos ataques; ataques contra ele têm desvantagem.'],
  ['paralisado', 'Paralisado', '⚡', 'Incapacitado e deslocamento 0. Falha em salvaguardas de Força e Destreza. Ataques contra ele têm vantagem; a até 1,5 m, acerto é crítico.'],
  ['petrificado', 'Petrificado', '🗿', 'Vira pedra: incapacitado, deslocamento 0, resistência a todo dano e imune a veneno. Ataques contra ele têm vantagem.'],
  ['surdo', 'Surdo', '🔇', 'Não ouve e falha em testes que dependem da audição.'],
  ['concentracao', 'Concentração', '🔮', 'Mantendo uma magia. Ao sofrer dano: salvaguarda de Constituição (CD 10 ou metade do dano, o maior, até 30).'],
].map(([id, nome, icone, texto]) => ({ id, nome, icone, texto }));
export const CONDICAO = Object.fromEntries(CONDICOES.map(c => [c.id, c]));
export const EXAUSTAO = 'Exaustão: cada nível dá −2 nos testes de d20 e −1,5 m no deslocamento. No nível 6, morre. Um descanso longo tira 1 nível.';

export function limparCondicoes(lista) {
  return [...new Set((Array.isArray(lista) ? lista : []).filter(k => CONDICAO[k]))].slice(0, 20);
}
