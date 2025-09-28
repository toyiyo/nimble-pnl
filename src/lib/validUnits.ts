// Valid units for receipts and inventory that work with our conversion system

export const VALID_UNITS = {
  // Volume units
  volume: ['ml', 'L', 'oz', 'cup', 'tbsp', 'tsp', 'gal', 'qt', 'pint'],
  
  // Weight units  
  weight: ['g', 'kg', 'oz', 'lb'],
  
  // Count/discrete units
  count: ['each', 'piece', 'serving', 'unit', 'bottle', 'can', 'box', 'bag', 'case', 'container', 'package', 'dozen'],
  
  // Length units (less common for recipes)
  length: ['inch', 'cm', 'mm', 'ft', 'meter']
};

export const ALL_VALID_UNITS = [
  ...VALID_UNITS.volume,
  ...VALID_UNITS.weight, 
  ...VALID_UNITS.count,
  ...VALID_UNITS.length
];

// Get unit options grouped by category
export const getUnitOptions = () => {
  return [
    {
      label: 'Volume',
      options: VALID_UNITS.volume.map(unit => ({ value: unit, label: unit }))
    },
    {
      label: 'Weight', 
      options: VALID_UNITS.weight.map(unit => ({ value: unit, label: unit }))
    },
    {
      label: 'Count/Discrete',
      options: VALID_UNITS.count.map(unit => ({ value: unit, label: unit }))
    },
    {
      label: 'Length',
      options: VALID_UNITS.length.map(unit => ({ value: unit, label: unit }))
    }
  ];
};

// Check if a unit is valid
export const isValidUnit = (unit: string): boolean => {
  return ALL_VALID_UNITS.includes(unit.toLowerCase());
};