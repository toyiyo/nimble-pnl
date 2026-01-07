/**
 * Package/Container Type Options
 * Reusable list of package types for inventory and receipt imports
 * Following DRY principle - single source of truth for package types
 */

export interface PackageTypeOption {
  value: string;
  label: string;
}

export interface PackageTypeGroup {
  label: string;
  options: PackageTypeOption[];
}

/**
 * Complete list of package types organized by category
 * Used in both:
 * - Product inventory (SizePackagingSection)
 * - Receipt import mapping (ReceiptMappingReview)
 */
export const PACKAGE_TYPE_OPTIONS: PackageTypeGroup[] = [
  {
    label: 'Primary',
    options: [
      { value: 'bag', label: 'Bag' },
      { value: 'box', label: 'Box' },
      { value: 'bottle', label: 'Bottle' },
      { value: 'can', label: 'Can' },
      { value: 'jar', label: 'Jar' },
      { value: 'tube', label: 'Tube' },
      { value: 'sachet', label: 'Sachet' },
      { value: 'packet', label: 'Packet' },
      { value: 'pouch', label: 'Pouch' },
      { value: 'tray', label: 'Tray' },
      { value: 'cup', label: 'Cup' },
      { value: 'bowl', label: 'Bowl' },
      { value: 'wrapper', label: 'Wrapper' },
      { value: 'carton', label: 'Carton' },
      { value: 'roll', label: 'Roll' },
      { value: 'stick', label: 'Stick' },
      { value: 'bar', label: 'Bar' },
      { value: 'piece', label: 'Piece' },
      { value: 'slice', label: 'Slice' },
      { value: 'loaf', label: 'Loaf' },
      { value: 'portion', label: 'Portion' },
      { value: 'pair', label: 'Pair' },
      { value: 'pod', label: 'Pod' },
      { value: 'capsule', label: 'Capsule' },
      { value: 'vial', label: 'Vial' },
    ],
  },
  {
    label: 'Secondary',
    options: [
      { value: 'case', label: 'Case' },
      { value: 'crate', label: 'Crate' },
      { value: 'pack', label: 'Pack' },
      { value: 'multipack', label: 'Multipack' },
      { value: 'sleeve', label: 'Sleeve' },
      { value: 'bundle', label: 'Bundle' },
      { value: 'set', label: 'Set' },
      { value: 'strip', label: 'Strip' },
      { value: 'carton_outer', label: 'Carton (Outer)' },
      { value: 'pallet', label: 'Pallet' },
      { value: 'display_box', label: 'Display Box' },
      { value: 'inner_pack', label: 'Inner Pack' },
    ],
  },
  {
    label: 'Bulk',
    options: [
      { value: 'drum', label: 'Drum' },
      { value: 'barrel', label: 'Barrel' },
      { value: 'bucket', label: 'Bucket' },
      { value: 'bin', label: 'Bin' },
      { value: 'sack', label: 'Sack' },
      { value: 'tote', label: 'Tote' },
      { value: 'tank', label: 'Tank' },
      { value: 'bag_bulk', label: 'Bag (Bulk)' },
      { value: 'box_bulk', label: 'Box (Bulk)' },
      { value: 'tub', label: 'Tub' },
      { value: 'jug', label: 'Jug' },
      { value: 'jerrycan', label: 'Jerrycan' },
      { value: 'carboy', label: 'Carboy' },
    ],
  },
  {
    label: 'Perishable',
    options: [
      { value: 'meat_tray', label: 'Tray (Meat/Deli)' },
      { value: 'pan', label: 'Pan' },
      { value: 'clamshell', label: 'Clamshell' },
      { value: 'vacuum_pack', label: 'Vacuum Pack' },
      { value: 'sleeve_pack', label: 'Sleeve Pack' },
      { value: 'film_wrap', label: 'Film Wrap' },
      { value: 'ice_block', label: 'Ice Block' },
      { value: 'brick', label: 'Brick' },
    ],
  },
  {
    label: 'Count/Special',
    options: [
      { value: 'sheet', label: 'Sheet' },
      { value: 'unit', label: 'Unit' },
      { value: 'portion_pack', label: 'Portion Pack' },
      { value: 'cone', label: 'Cone' },
      { value: 'disc', label: 'Disc' },
      { value: 'ring', label: 'Ring' },
      { value: 'skewer', label: 'Skewer' },
      { value: 'strip_cut', label: 'Strip (Cut)' },
      { value: 'segment', label: 'Segment' },
      { value: 'serving', label: 'Serving' },
    ],
  },
  {
    label: 'Industrial/Supplies',
    options: [
      { value: 'roll_material', label: 'Roll (Material)' },
      { value: 'coil', label: 'Coil' },
      { value: 'reel', label: 'Reel' },
      { value: 'cartridge', label: 'Cartridge' },
      { value: 'canister', label: 'Canister' },
      { value: 'cylinder', label: 'Cylinder' },
      { value: 'container', label: 'Container' },
      { value: 'dispenser', label: 'Dispenser' },
      { value: 'refill_pack', label: 'Refill Pack' },
    ],
  },
];

/**
 * Get all package type values as a flat array
 */
export const getAllPackageTypes = (): string[] => {
  return PACKAGE_TYPE_OPTIONS.flatMap(group => 
    group.options.map(option => option.value)
  );
};

/**
 * Check if a value is a valid package type
 */
export const isValidPackageType = (value: string): boolean => {
  return getAllPackageTypes().includes(value);
};

/**
 * Get the display label for a package type value
 */
export const getPackageTypeLabel = (value: string): string => {
  for (const group of PACKAGE_TYPE_OPTIONS) {
    const option = group.options.find(opt => opt.value === value);
    if (option) return option.label;
  }
  return value; // Fallback to value if not found
};
