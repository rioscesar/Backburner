export const fp = 'a'.repeat(64);
export const otherFp = 'b'.repeat(64);
export const node = (id='1', extra={}) => ({id, title:'Synthetic bookmark', url:'https://example.com/item',dateAdded:1000,fingerprint:fp,...extra});
