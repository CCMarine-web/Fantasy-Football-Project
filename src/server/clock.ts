/**
 * The server's clock, read outside a component body.
 *
 * Live counters (the draft countdown, the reign counter, the shame counter) need
 * a starting figure in the server-rendered HTML, otherwise the headline number
 * is simply missing until JavaScript has run. That means a server component has
 * to read the time — but calling `Date.now()` inside a component body is an
 * impure render, which React's lint rules correctly reject.
 *
 * Reading it here, from an ordinary async function the component awaits, puts
 * the impurity at a data-fetching boundary where it belongs. It is the same
 * thing `getSeasonPhase()` does with its `nowMs` field, generalised so pages
 * that do not need the whole season phase can still seed a counter.
 */
export async function readServerClock(): Promise<number> {
  return Date.now();
}
