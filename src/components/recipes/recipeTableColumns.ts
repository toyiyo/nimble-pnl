/** Shared between the recipe table header and its rows so the columns line up. */
export const RECIPE_COLUMN_WIDTHS = {
  name: 'flex-1 min-w-[220px]',
  posItem: 'w-[150px]',
  conversions: 'w-[140px]',
  servingSize: 'w-[110px]',
  cost: 'w-[100px]',
  salePrice: 'w-[130px]',
  profit: 'w-[110px]',
  margin: 'w-[100px]',
  created: 'w-[120px]',
  actions: 'w-[80px] text-right',
} as const;

/** Widest layout the columns above can settle at, for the horizontal scroller. */
export const RECIPE_TABLE_MIN_WIDTH = 'min-w-[1260px]';
