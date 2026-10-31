/**
 * Geometria discreta usada pelo motor.
 *
 * Convenção de coordenadas (igual à de tela e à de leitura de uma folha):
 *   x cresce para a direita, y cresce para baixo; linha 0 = topo.
 *
 * As transformações de orientação são matrizes 2×2 inteiras com entradas em {-1, 0, 1}
 * (grupo diedral D4). Não há ponto flutuante na topologia da imposição: posições,
 * faces e rotações são exatas. Medidas em milímetros só entram na etapa de layout.
 */

/** Matriz [a, b, c, d] representando x' = a·x + b·y ; y' = c·x + d·y. */
export type Mat2 = readonly [number, number, number, number];

export const I: Mat2 = [1, 0, 0, 1];
/** Espelha no eixo vertical (x → −x). Virar uma folha "da esquerda para a direita". */
export const RX: Mat2 = [-1, 0, 0, 1];
/** Espelha no eixo horizontal (y → −y). Virar uma folha "de cima para baixo". */
export const RY: Mat2 = [1, 0, 0, -1];
/** Rotação de 90° no sentido horário (em coordenadas de tela). */
export const R90: Mat2 = [0, -1, 1, 0];
export const R180: Mat2 = [-1, 0, 0, -1];
export const R270: Mat2 = [0, 1, -1, 0];

export function mul(p: Mat2, q: Mat2): Mat2 {
  return [
    p[0] * q[0] + p[1] * q[2],
    p[0] * q[1] + p[1] * q[3],
    p[2] * q[0] + p[3] * q[2],
    p[2] * q[1] + p[3] * q[3],
  ];
}

export function det(m: Mat2): number {
  return m[0] * m[3] - m[1] * m[2];
}

/** Inversa de uma matriz ortogonal inteira (transposta). */
export function inv(m: Mat2): Mat2 {
  return [m[0], m[2], m[1], m[3]];
}

export function eq(p: Mat2, q: Mat2): boolean {
  return p[0] === q[0] && p[1] === q[1] && p[2] === q[2] && p[3] === q[3];
}

export function apply(m: Mat2, v: readonly [number, number]): [number, number] {
  return [m[0] * v[0] + m[1] * v[1], m[2] * v[0] + m[3] * v[1]];
}

export type Rotation = 0 | 90 | 180 | 270;

/** Converte matriz de rotação própria (det = +1) em graus horários. Lança erro se for reflexão. */
export function rotationOf(m: Mat2): Rotation {
  if (eq(m, I)) return 0;
  if (eq(m, R90)) return 90;
  if (eq(m, R180)) return 180;
  if (eq(m, R270)) return 270;
  throw new Error(`Matriz não é rotação própria: [${m.join(',')}] (det=${det(m)})`);
}

export function rotationMat(r: Rotation): Mat2 {
  return r === 0 ? I : r === 90 ? R90 : r === 180 ? R180 : R270;
}

export function addRot(a: Rotation, b: Rotation): Rotation {
  return (((a + b) % 360) as Rotation);
}

export type Edge = 'left' | 'top' | 'right' | 'bottom';
/** Ordem horária das bordas; avançar 1 posição = girar 90° no sentido horário. */
export const EDGES_CW: readonly Edge[] = ['left', 'top', 'right', 'bottom'];

export const EDGE_NORMAL: Record<Edge, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  top: [0, -1],
  bottom: [0, 1],
};

export function edgeFromNormal(n: readonly [number, number]): Edge {
  if (n[0] === -1 && n[1] === 0) return 'left';
  if (n[0] === 1 && n[1] === 0) return 'right';
  if (n[0] === 0 && n[1] === -1) return 'top';
  if (n[0] === 0 && n[1] === 1) return 'bottom';
  throw new Error(`Normal inválida: ${n.join(',')}`);
}

export function oppositeEdge(e: Edge): Edge {
  return e === 'left' ? 'right' : e === 'right' ? 'left' : e === 'top' ? 'bottom' : 'top';
}

/** Rotação horária mínima que leva a borda `from` até a borda `to`. */
export function rotationBetweenEdges(from: Edge, to: Edge): Rotation {
  const steps = (EDGES_CW.indexOf(to) - EDGES_CW.indexOf(from) + 4) % 4;
  return (steps * 90) as Rotation;
}
