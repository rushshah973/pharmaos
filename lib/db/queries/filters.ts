// Optional product filter shared by the read queries: one product id or a list of them.
export type ProductFilter = string | string[] | undefined;
export const productIds = (p: string | string[]) => (Array.isArray(p) ? p : [p]);
