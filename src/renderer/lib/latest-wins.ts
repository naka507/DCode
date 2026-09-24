/**
 * Serialize async UI requests so only the newest one may write state.
 * A request-identity gate for async UI reads: issue a token per request and
 * let only the newest one write state. Without it, two overlapping reads land
 * out of order and the slower, stale answer wins. `begin` issues the token;
 * `invalidate` represents the close/reopen path where no in-flight response
 * may land at all.
 */
export class LatestWinsGate {
  private current = 0;

  begin(): number {
    this.current += 1;
    return this.current;
  }

  isCurrent(token: number): boolean {
    return token === this.current;
  }

  invalidate(): void {
    this.current += 1;
  }
}
