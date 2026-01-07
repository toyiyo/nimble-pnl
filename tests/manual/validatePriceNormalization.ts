/**
 * Manual validation script for receipt price normalization
 * Run with: npx tsx tests/manual/validatePriceNormalization.ts
 */

// Test scenarios matching the problem statement
const testScenarios = [
  {
    name: "Bug Case: AI extracts unit price, receipt shows both",
    receipt: "2 Avocados @ $1.00 ea = $2.00",
    aiExtracted: { unitPrice: 1.00, lineTotal: 2.00 },
    quantity: 2,
    expectedUnitPrice: 1.00,
    expectedLineTotal: 2.00,
  },
  {
    name: "Only line total visible (bulk item)",
    receipt: "CHICKEN BREAST 5LB $15.00",
    aiExtracted: { lineTotal: 15.00 },
    quantity: 5,
    expectedUnitPrice: 3.00,
    expectedLineTotal: 15.00,
  },
  {
    name: "Only unit price visible",
    receipt: "ONIONS $0.50/ea x 10",
    aiExtracted: { unitPrice: 0.50 },
    quantity: 10,
    expectedUnitPrice: 0.50,
    expectedLineTotal: 5.00,
  },
  {
    name: "Legacy format (parsedPrice only)",
    receipt: "Tomatoes (3) $6.00",
    aiExtracted: { parsedPrice: 6.00 },
    quantity: 3,
    expectedUnitPrice: 2.00,
    expectedLineTotal: 6.00,
  },
  {
    name: "Price mismatch - trust lineTotal",
    receipt: "Mystery Item",
    aiExtracted: { unitPrice: 1.00, lineTotal: 5.00 },
    quantity: 10,
    expectedUnitPrice: 0.50, // Recalculated from lineTotal
    expectedLineTotal: 5.00,
  },
];

function normalizePrices(item: any): any {
  let unitPrice = item.unitPrice;
  let lineTotal = item.lineTotal;
  const quantity = item.parsedQuantity || 1;

  // Handle backward compatibility with old parsedPrice field
  if (unitPrice === undefined && lineTotal === undefined && item.parsedPrice !== undefined) {
    lineTotal = item.parsedPrice;
    unitPrice = quantity > 0 ? lineTotal / quantity : lineTotal;
  }

  // If only unitPrice provided, calculate lineTotal
  if (unitPrice !== undefined && lineTotal === undefined) {
    lineTotal = unitPrice * quantity;
  }

  // If only lineTotal provided, calculate unitPrice
  if (lineTotal !== undefined && unitPrice === undefined) {
    unitPrice = quantity > 0 ? lineTotal / quantity : lineTotal;
  }

  // Validation: check if lineTotal ≈ quantity × unitPrice (allow 2% tolerance for rounding)
  if (unitPrice !== undefined && lineTotal !== undefined) {
    const expectedTotal = unitPrice * quantity;
    const tolerance = Math.max(0.02, expectedTotal * 0.02);

    if (Math.abs(lineTotal - expectedTotal) > tolerance) {
      console.log(`  ⚠️  Price mismatch: ${quantity} × $${unitPrice} = $${expectedTotal}, but lineTotal = $${lineTotal}`);
      unitPrice = quantity > 0 ? lineTotal / quantity : lineTotal;
    }
  }

  return {
    unitPrice: unitPrice || 0,
    lineTotal: lineTotal || 0,
    parsedPrice: lineTotal || item.parsedPrice || 0,
  };
}

console.log("🧪 Receipt Price Normalization Validation\n");
console.log("=" .repeat(70));

let allPassed = true;

testScenarios.forEach((scenario, index) => {
  console.log(`\nTest ${index + 1}: ${scenario.name}`);
  console.log(`  Receipt: "${scenario.receipt}"`);
  console.log(`  AI Extracted:`, JSON.stringify(scenario.aiExtracted));
  
  const input = {
    ...scenario.aiExtracted,
    parsedQuantity: scenario.quantity,
  };
  
  const result = normalizePrices(input);
  
  const unitPricePassed = Math.abs(result.unitPrice - scenario.expectedUnitPrice) < 0.01;
  const lineTotalPassed = Math.abs(result.lineTotal - scenario.expectedLineTotal) < 0.01;
  const passed = unitPricePassed && lineTotalPassed;
  
  console.log(`  Result: unitPrice=$${result.unitPrice.toFixed(2)}, lineTotal=$${result.lineTotal.toFixed(2)}`);
  console.log(`  Expected: unitPrice=$${scenario.expectedUnitPrice.toFixed(2)}, lineTotal=$${scenario.expectedLineTotal.toFixed(2)}`);
  console.log(`  Status: ${passed ? "✅ PASS" : "❌ FAIL"}`);
  
  if (!passed) {
    allPassed = false;
    if (!unitPricePassed) {
      console.log(`    ❌ Unit price mismatch: got $${result.unitPrice}, expected $${scenario.expectedUnitPrice}`);
    }
    if (!lineTotalPassed) {
      console.log(`    ❌ Line total mismatch: got $${result.lineTotal}, expected $${scenario.expectedLineTotal}`);
    }
  }
});

console.log("\n" + "=".repeat(70));
console.log(`\n${allPassed ? "✅ All tests passed!" : "❌ Some tests failed"}\n`);

process.exit(allPassed ? 0 : 1);
