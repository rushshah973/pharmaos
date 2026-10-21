// §6.2a — closed-form ridge regression: w = (XᵀX + λI)⁻¹ Xᵀy, solved with Cholesky.
// Features are standardised; the intercept is not penalised (it is the mean of y on standardised X).

export type RidgeModel = {
  featureNames: string[];
  means: number[];
  stds: number[];
  coefficients: number[]; // on standardised features
  intercept: number;
  lambda: number;
};

/** Solves (A + λI) w = b for a symmetric positive semi-definite A, by Cholesky (A + λI = L Lᵀ). */
export function solveRidge(a: number[][], b: number[], lambda: number): number[] {
  const n = b.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i][j] + (i === j ? lambda : 0);
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 0) throw new Error("Ridge system is not positive definite; increase λ.");
        L[i][i] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  // Forward substitution L z = b, then back substitution Lᵀ w = z.
  const z = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) sum -= L[i][k] * z[k];
    z[i] = sum / L[i][i];
  }
  const w = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = z[i];
    for (let k = i + 1; k < n; k++) sum -= L[k][i] * w[k];
    w[i] = sum / L[i][i];
  }
  return w;
}

/** Column means and standard deviations (a constant column gets std 1 so it standardises to 0). */
export function standardiser(X: number[][]): { means: number[]; stds: number[] } {
  const p = X[0]?.length ?? 0;
  const means = new Array<number>(p).fill(0);
  const stds = new Array<number>(p).fill(0);
  for (const row of X) for (let j = 0; j < p; j++) means[j] += row[j];
  for (let j = 0; j < p; j++) means[j] /= X.length;
  for (const row of X) for (let j = 0; j < p; j++) stds[j] += (row[j] - means[j]) ** 2;
  for (let j = 0; j < p; j++) {
    const s = Math.sqrt(stds[j] / X.length);
    stds[j] = s > 1e-12 ? s : 1;
  }
  return { means, stds };
}

export function fitRidge(X: number[][], y: number[], lambda: number, featureNames: string[]): RidgeModel {
  if (X.length === 0) throw new Error("fitRidge needs at least one row.");
  const { means, stds } = standardiser(X);
  const p = means.length;
  const ybar = y.reduce((a, b) => a + b, 0) / y.length;
  const xtx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xty = new Array<number>(p).fill(0);
  const z = new Array<number>(p);
  for (let r = 0; r < X.length; r++) {
    for (let j = 0; j < p; j++) z[j] = (X[r][j] - means[j]) / stds[j];
    const yc = y[r] - ybar;
    for (let i = 0; i < p; i++) {
      xty[i] += z[i] * yc;
      for (let j = 0; j <= i; j++) xtx[i][j] += z[i] * z[j];
    }
  }
  for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) xtx[i][j] = xtx[j][i];
  return { featureNames, means, stds, coefficients: solveRidge(xtx, xty, lambda), intercept: ybar, lambda };
}

export function predict(model: RidgeModel, x: number[]): number {
  let y = model.intercept;
  for (let j = 0; j < x.length; j++) y += model.coefficients[j] * ((x[j] - model.means[j]) / model.stds[j]);
  return y;
}

/** Each feature's contribution to one prediction (coefficient × standardised value), largest first. */
export function contributions(model: RidgeModel, x: number[]): { name: string; value: number; contribution: number }[] {
  return x
    .map((value, j) => ({ name: model.featureNames[j], value, contribution: model.coefficients[j] * ((value - model.means[j]) / model.stds[j]) }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}
