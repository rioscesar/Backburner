export const fp = 'a'.repeat(64);
export const otherFp = 'b'.repeat(64);
export const node = (id='1', extra={}) => ({id, title:'Synthetic bookmark', url:'https://example.com/item',dateAdded:1000,fingerprint:fp,...extra});
export const seededRandom = seed => () => ((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
