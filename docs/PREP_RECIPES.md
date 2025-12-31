

# **User Journey: Culinary Production & Inventory Transformation**


## **From Ingredients → Prep → Sale (Lovable + Supabase)**

This document describes the **end-to-end user journey** for kitchen staff, managers, and operators using the Culinary Production System. It translates the architectural and accounting model into **clear, real-world flows** that feel natural in a restaurant environment while remaining accounting-correct and DDD-sound.

The journey is organized by **user intent**, not by internal system concepts.


---


## **1. Who This Is For**


### **Primary Users**



* **Kitchen Staff / Prep Lead**
    * Executes prep (batches)
    * Reports actual usage and yield
* **Manager / Operator**
    * Sets up prep recipes
    * Monitors inventory, variance, and cost
* **Accountant / Owner**
    * Reviews Daily P&L
    * Trusts COGS accuracy


---


## **2. Mental Model (What Users Understand)**


    “We buy ingredients, we make food, we sell food.”

Internally this maps to:



* **Buy** → Purchase
* **Make** → Production Run (Asset Conversion)
* **Sell** → Sale (COGS Recognition)

The system must **never expose accounting mechanics** to kitchen users.


---


## **3. Journey Overview (Happy Path)**



1. Manager defines what can be made (Prep Recipe)
2. Kitchen makes a batch (Production Run)
3. Inventory updates automatically (no COGS yet)
4. POS sales consume prep items (COGS happens here)
5. Manager reviews cost, variance, and inventory signals


---


## **4. Setup Journey (One-Time / Infrequent)**


### **4.1 Define Inventory Items**

**Actor:** Manager**Location:** Inventory → Items


#### **Steps**



1. Manager creates or edits an item.
2. Chooses **Item Type**:
    * Raw (e.g., Raw Chicken)
    * Prep (e.g., Chicken Soup Base)
3. Chooses **Replenishment Method**:
    * Purchase (Raw)
    * Produce (Prep)


#### **Result**



* System now knows *how* this item increases.
* Prep items cannot be purchased directly.


---


### **4.2 Create a Production Recipe (Prep Recipe)**

**Actor:** Manager**Location:** Prep → Recipes → New Recipe


#### **Steps**



1. Select **Output Item** (e.g., Chicken Soup Base).
2. Enter **Default Yield** (e.g., 10 Liters).
3. Add **Ingredients**:
    * Raw Chicken – 5 kg
    * Water – 5 L
    * Spices – 0.2 kg
4. Save recipe.


#### **System Behavior**



* Recipe is stored as a **blueprint only**.
* No inventory or accounting impact.


#### **User Understanding**


    “This is how we usually make soup.”


---


## **5. Daily Operations: Production (The Core Journey)**


### **Phase 1: Planning (Prep List)**

**Actor:** Kitchen Staff / Manager**Location:** Prep → Batches → New Batch


#### **Steps**



1. Click **New Production Run**.
2. Select a **Prep Recipe** (Chicken Soup Base).
3. Enter **Target Yield**:
    * Default: 10 L
    * User can scale (e.g., 20 L).
4. System auto-scales ingredients.
5. Save as **Draft**.


#### **System State**



* `ProductionRun.status = Draft`
* No inventory changes yet.


---


### **Phase 2: Execution & Variance (Cooking Reality)**

**Actor:** Kitchen Staff**Location:** Prep → Batches → Draft Batch


#### **Screen Layout**


<table>
  <tr>
   <td><strong>Ingredient</strong>
   </td>
   <td><strong>Expected</strong>
   </td>
   <td><strong>Actual</strong>
   </td>
  </tr>
  <tr>
   <td>Raw Chicken
   </td>
   <td>10 kg
   </td>
   <td>[10.5]
   </td>
  </tr>
  <tr>
   <td>Water
   </td>
   <td>10 L
   </td>
   <td>[10]
   </td>
  </tr>
  <tr>
   <td>Spices
   </td>
   <td>0.4 kg
   </td>
   <td>[0.4]
   </td>
  </tr>
</table>


Additional Field:



* **Actual Yield Produced:** `[18 L]`


#### **Steps**



1. Kitchen finishes cooking.
2. Staff opens the Draft batch.
3. Adjusts **Actual quantities used** (defaults pre-filled).
4. Enters **Actual Yield**.
5. Clicks **Complete Batch**.


---


### **Phase 3: Commit (Invisible but Critical)**

**Actor:** System**Trigger:** “Complete Batch”


#### **What Happens Atomically (Supabase RPC)**



1. **Inventory Transfers**
    * Raw Chicken: −10.5 kg (Transfer Out)
    * Water: −10 L (Transfer Out)
    * Chicken Soup Base: +18 L (Transfer In)
2. **Cost Locking**
    * Ingredient costs are snapshotted.
    * Total batch cost calculated.
    * Cost per liter stored for historical accuracy.
3. **Status Update**
    * `ProductionRun.status = Completed`


#### **Accounting Impact**



* **No COGS**
* **No P&L impact**
* Balance sheet remains accurate.


---


### **Phase 4: Feedback to User**

**UI Confirmation**



* “Batch completed successfully”
* “18 L Chicken Soup Base added to inventory”
* “Cost per liter: $X.XX”


---


## **6. Selling the Product (Where COGS Happens)**


### **6.1 Menu Mapping (Setup)**

**Actor:** Manager**Location:** Menu → POS Mapping


#### **Example: “Cup of Soup”**



* Consumes:
    * Chicken Soup Base – 0.3 L

Saved as **Menu Recipe**.


---


### **6.2 POS Sale**

**Actor:** Customer (via POS)**System Flow:**



1. POS reports sale of “Cup of Soup”.
2. System reduces:
    * Chicken Soup Base: −0.3 L
3. System records:
    * **Cost of Goods Used (COGS)** using the prep item’s cost.


#### **Accounting Impact**



* Inventory ↓
* COGS ↑
* Revenue matched correctly.


---


## **7. Variance & Waste Handling**


### **7.1 Waste During Prep**

**Scenario**



* Chef drops 1 kg of chicken.

**User Action**



* Enters actual usage higher than expected OR
* Flags explicit waste (future UX)

**System**



* Excess usage is recorded.
* Optional waste transaction created.

**Accounting**



* Waste recognized as expense.
* Inventory accurate.


---


### **7.2 Spoilage / Expired Prep**

**Actor:** Manager**Location:** Inventory → Prep Items


#### **Steps**



1. Select Prep Item.
2. Click “Mark Waste”.
3. Enter quantity discarded.

**System**



* Inventory ↓
* Waste transaction posted.


---


## **8. Manager Review Journeys**


### **8.1 Inventory Signals**

**Location:** Inventory Dashboard



* Raw Chicken: Low
* Chicken Soup Base: 3.2 L remaining

**Action**



* Trigger new Production Run.


---


### **8.2 Variance Review**

**Location:** Prep → Reports → Variance

Shows:



* Expected vs Actual ingredient usage
* Yield loss %
* Cost per unit trends

Supports:



* Training
* Portion control
* Supplier quality review


---


### **8.3 Daily P&L (Trust Layer)**

**Location:** Reports → Daily P&L

Key Properties:



* COGS aligns to sales
* Prep does not distort profitability
* Waste visible but separated


---


## **9. Failure & Recovery Paths**


### **Selling Without Prep Logged**



* Prep inventory goes negative.
* UI warns: “You sold 6.0 L without logging production.”
* Manager can backfill a Production Run.


### **Inventory Count Drift**



* Adjustment allowed, but flagged.
* Adjustment reports highlight process gaps.


---


## **10. Guiding UX Principles (Non-Negotiable)**



1. **Kitchen users never see accounting terms**
2. **Prep never hits COGS**
3. **Actual always beats theoretical**
4. **Every inventory change has a reason**
5. **If no customer was involved, it’s not COGS**


---


## **11. One-Sentence User Journey Summary**


    *Managers define how food is made, kitchens record what actually happened, inventory updates automatically, and costs are only realized when food is sold.*

This journey preserves **operational truth**, **financial accuracy**, and **user trust**—without forcing restaurant staff to think like accountants.
