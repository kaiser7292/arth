# Convert Bottom Sheets to Full-Screen Forms

Convert the bottom sheet forms for loans (Record Prepayment, Manual Correction) and cash flow simulator (Add Entry) to separate full-screen route pages with all fields visible at once, following the expense details pattern.

## Current State

### Loans Page (`app/loans/[id].tsx`)
- Uses `PrepaymentSheet` - Modal with slide-up animation for recording loan prepayments
- Uses `ManualCorrectionSheet` - Modal with slide-up animation for manual corrections
- Both are bottom sheets with form fields inside a Modal
- State: `prepaymentSheetVisible`, `correctionSheetVisible`, `editingPrepayment`, `editingCorrection`

### Cash Flow Simulator (`app/simulator/[id].tsx`)
- Uses `EntryEditSheet` - Modal with slide-up animation for adding/editing planned entries
- Bottom sheet with form fields inside a Modal
- State: `entrySheetVisible`, `entrySheetInitial`

### Expense Details Pattern (`app/expense/[id].tsx`)
- Full-screen page with inline editing mode
- Form fields are directly on the page (not in a bottom sheet)
- Has header with back button
- KeyboardAvoidingView with ScrollView
- Form fields are inline components

## Target State

### New Route Pages
1. `app/loans/[id]/prepayment.tsx` - Full-screen form for recording/editing prepayments
2. `app/loans/[id]/correction.tsx` - Full-screen form for manual corrections
3. `app/simulator/[id]/entry.tsx` - Full-screen form for adding/editing simulator entries

### Form Structure
- All fields visible at once (scrollable single page)
- Preview UI at the bottom (for prepayment impact calculations)
- Header with back button and title
- KeyboardAvoidingView with ScrollView
- Save/Cancel buttons at the bottom

## Implementation Plan

### Step 1: Create Prepayment Form Page

**File**: `app/loans/[id]/prepayment.tsx`

This will be a new route page that replaces the `PrepaymentSheet` bottom sheet.

**Key Changes**:
- Remove Modal wrapper and slide-up animation
- Use ScreenContainer with header
- Move form fields to inline layout
- Keep preview section at the bottom
- Add header with back button

**Code Structure**:
```tsx
import { Input } from "@/components/ui";
import { CalendarModal } from "@/components/ui/CalendarModal";
import { Button, ScreenContainer } from "@/components/ui";
import { Toggle } from "@/components/goals";
// ... other imports

export default function PrepaymentForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors, accent } = useColorScheme();

  // Form state (same as PrepaymentSheet)
  const [amount, setAmount] = useState("");
  const [strategy, setStrategy] = useState<"reduce_tenure" | "reduce_emi">("reduce_tenure");
  const [prepayDate, setPrepayDate] = useState(new Date().toISOString().split("T")[0]);
  // ... other state

  // Load loan data
  useEffect(() => {
    // Fetch loan, schedule, prepayments
  }, [id]);

  // Impact calculation (same as PrepaymentSheet)
  const impact = useMemo(() => {
    // computePrepaymentImpact logic
  }, [loan, schedule, prepayments, amountNum, prepayDate, strategy]);

  const handleSave = async () => {
    // Call recordPrepayment or updatePrepayment
    await recordPrepayment(id, payload);
    router.back();
  };

  return (
    <ScreenContainer>
      {/* Header */}
      <View className="flex-row items-center mb-4">
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-lg font-bold ml-3">Record Prepayment</Text>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled">
        {/* Form fields */}
        <Input label="Amount" value={amount} onChangeText={setAmount} />
        <DateSelector value={prepayDate} onChange={setPrepayDate} />
        <Toggle label="Strategy" value={strategy} onChange={setStrategy} />

        {/* Preview at bottom */}
        {impact && (
          <View className="mt-4 p-3 rounded-xl">
            <Text className="text-xs font-semibold">Preview</Text>
            <ImpactRow label="Prepayment" value={formatMoney(amountNum)} />
            <ImpactRow label="Charge" value={impact.charge > 0 ? `− ${formatMoney(impact.charge)}` : "— waived"} />
            {/* ... more preview rows */}
          </View>
        )}
      </ScrollView>

      {/* Save/Cancel buttons */}
      <View className="flex-row gap-3 mt-4">
        <Button title="Cancel" variant="outline" onPress={() => router.back()} />
        <Button title="Record" onPress={handleSave} disabled={amountNum <= 0} />
      </View>
    </ScreenContainer>
  );
}
```

**Why This Works**:
- Removes Modal and animation (no longer needed for full-screen page)
- Uses standard navigation pattern (back button in header)
- Preserves all form logic and validation
- Preview stays at bottom as requested
- All fields visible at once in ScrollView

### Step 2: Create Correction Form Page

**File**: `app/loans/[id]/correction.tsx`

Similar structure to prepayment form but for manual corrections.

**Code Structure**:
```tsx
export default function CorrectionForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  // Form state
  const [effectiveDate, setEffectiveDate] = useState("");
  const [outstanding, setOutstanding] = useState("");
  const [emi, setEmi] = useState("");
  const [tenureRemaining, setTenureRemaining] = useState("");
  const [reason, setReason] = useState("");

  const handleSave = async () => {
    await createCorrection(id, payload);
    router.back();
  };

  return (
    <ScreenContainer>
      <View className="flex-row items-center mb-4">
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} />
        </Pressable>
        <Text className="text-lg font-bold ml-3">Manual Correction</Text>
      </View>

      <ScrollView>
        <DateSelector label="Effective Date" value={effectiveDate} onChange={setEffectiveDate} />
        <Input label="Outstanding Principal" value={outstanding} onChangeText={setOutstanding} />
        <Input label="EMI Amount" value={emi} onChangeText={setEmi} />
        <Input label="Tenure Remaining (optional)" value={tenureRemaining} onChangeText={setTenureRemaining} />
        <Input label="Reason (optional)" value={reason} onChangeText={setReason} />
      </ScrollView>

      <View className="flex-row gap-3 mt-4">
        <Button title="Cancel" variant="outline" onPress={() => router.back()} />
        <Button title="Submit" onPress={handleSave} />
      </View>
    </ScreenContainer>
  );
}
```

**Why This Works**:
- Simple form without preview section
- All fields visible at once
- Standard navigation pattern
- Preserves validation logic

### Step 3: Create Simulator Entry Form Page

**File**: `app/simulator/[id]/entry.tsx`

This replaces `EntryEditSheet` with a full-screen form.

**Code Structure**:
```tsx
export default function SimulatorEntryForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { scenarioId } = useLocalSearchParams<{ scenarioId: string }>();
  const router = useRouter();

  // Form state (same as EntryEditSheet)
  const [flavor, setFlavor] = useState<EntryFlavor>("out");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [merchant, setMerchant] = useState("");
  const [description, setDescription] = useState("");

  const handleSave = async () => {
    if (initial) {
      await updateEntry(initial.id, payload);
    } else {
      await createEntry(scenarioId, payload);
    }
    router.back();
  };

  return (
    <ScreenContainer>
      <View className="flex-row items-center mb-4">
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} />
        </Pressable>
        <Text className="text-lg font-bold ml-3">{initial ? "Edit Entry" : "Add Entry"}</Text>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled">
        {/* Kind selector - 2x2 chip grid */}
        <View className="flex-row flex-wrap gap-2 mb-4">
          {flavors.map(f => (
            <Pressable
              key={f.key}
              onPress={() => setFlavor(f.key)}
              style={{ backgroundColor: flavor === f.key ? accent[500] : colors.surface }}
            >
              <Ionicons name={f.icon} />
              <Text>{f.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Hisaab person (if applicable) */}
        {isHisaab && <PersonPicker selected={personId} onSelect={setPersonId} />}

        {/* Amount */}
        <Input label="Amount" value={amount} onChangeText={setAmount} keyboardType="numeric" />

        {/* Date */}
        <DateSelector value={date} onChange={setDate} />

        {/* Account */}
        <AccountPicker selected={accountId} onSelect={setAccountId} />

        {/* To account (for transfer) */}
        {flavor === "transfer" && <AccountPicker label="To account" selected={toAccountId} onSelect={setToAccountId} />}

        {/* Category (outgoing only) */}
        {direction === "out" && !isHisaab && <CategoryPicker selected={categoryId} onSelect={setCategoryId} />}

        {/* Merchant */}
        {!isHisaab && <Input label="Merchant (optional)" value={merchant} onChangeText={setMerchant} />}

        {/* Description */}
        <Input label="Description (optional)" value={description} onChangeText={setDescription} multiline />
      </ScrollView>

      <View className="flex-row gap-3 mt-4">
        <Button title="Cancel" variant="outline" onPress={() => router.back()} />
        <Button title="Save" onPress={handleSave} disabled={!canSave} />
      </View>
    </ScreenContainer>
  );
}
```

**Why This Works**:
- All fields visible at once in ScrollView
- Kind selector as chip grid (preserves current UX)
- Conditional fields based on flavor (hisaab, transfer)
- Standard navigation pattern
- Preserves all validation logic

### Step 4: Update Loans Detail Page

**File**: `app/loans/[id].tsx`

**Changes**:
- Remove bottom sheet state and components
- Update button onPress to navigate to new routes
- Pass loan ID and optional editing data as params

**Code Changes**:
```tsx
// Remove these states:
// const [prepaymentSheetVisible, setPrepaymentSheetVisible] = useState(false);
// const [correctionSheetVisible, setCorrectionSheetVisible] = useState(false);
// const [editingPrepayment, setEditingPrepayment] = useState(null);
// const [editingCorrection, setEditingCorrection] = useState(null);

// Remove these components from JSX:
// <PrepaymentSheet visible={prepaymentSheetVisible} ... />
// <ManualCorrectionSheet visible={correctionSheetVisible} ... />

// Update Record Prepayment button:
<Button
  title="Record Prepayment"
  onPress={() => router.push({
    pathname: "/loans/[id]/prepayment",
    params: { id: loan.id }
  } as never)}
/>

// Update Manual Correction tile:
<ActionTile
  icon="construct-outline"
  label="Manual correction"
  onPress={() => router.push({
    pathname: "/loans/[id]/correction",
    params: { id: loan.id }
  } as never)}
/>

// For editing prepayments (from prepayment list):
<Pressable
  onPress={() => router.push({
    pathname: "/loans/[id]/prepayment",
    params: { id: loan.id, prepaymentId: p.id }
  } as never)}
>
```

**Why This Works**:
- Removes Modal state management complexity
- Uses standard navigation pattern
- Cleaner component (no bottom sheet logic)
- Easier to maintain

### Step 5: Update Simulator Detail Page

**File**: `app/simulator/[id].tsx`

**Changes**:
- Remove bottom sheet state
- Update FAB onPress to navigate to new route
- Pass scenario ID and optional editing data as params

**Code Changes**:
```tsx
// Remove these states:
// const [entrySheetVisible, setEntrySheetVisible] = useState(false);
// const [entrySheetInitial, setEntrySheetInitial] = useState(null);

// Remove EntryEditSheet from JSX:
// <EntryEditSheet visible={entrySheetVisible} ... />

// Update FAB:
<FAB
  icon="add"
  onPress={() => router.push({
    pathname: "/simulator/[id]/entry",
    params: { id: scenario.id }
  } as never)}
/>

// Update entry edit press:
<Pressable
  onPress={() => router.push({
    pathname: "/simulator/[id]/entry",
    params: { id: scenario.id, entryId: entry.id }
  } as never)}
>
```

**Why This Works**:
- Simpler state management
- Standard navigation pattern
- FAB behavior unchanged from user perspective

### Step 6: Handle Edit Mode in New Pages

For editing existing entries, the new pages need to accept edit parameters:

**Prepayment Form**:
```tsx
const { id, prepaymentId } = useLocalSearchParams<{ id: string; prepaymentId?: string }>();

useEffect(() => {
  if (prepaymentId) {
    // Load existing prepayment data
    const existing = prepayments.find(p => p.id === prepaymentId);
    if (existing) {
      setAmount(String(existing.amount));
      setStrategy(existing.strategy ?? "reduce_tenure");
      setPrepayDate(existing.prepayment_date);
    }
  }
}, [prepaymentId, prepayments]);

const handleSave = async () => {
  if (prepaymentId) {
    await updatePrepayment(prepaymentId, payload);
  } else {
    await recordPrepayment(id, payload);
  }
  router.back();
};
```

**Simulator Entry Form**:
```tsx
const { id, entryId } = useLocalSearchParams<{ id: string; entryId?: string }>();

useEffect(() => {
  if (entryId) {
    const existing = entries.find(e => e.id === entryId);
    if (existing) {
      setAmount(String(existing.amount));
      setDate(existing.date);
      setAccountId(existing.account_id);
      // ... other fields
    }
  }
}, [entryId, entries]);
```

**Why This Works**:
- Single page handles both create and edit
- Params distinguish between modes
- Reuses existing data loading logic
- Consistent with expense details pattern

### Step 7: Delete Old Bottom Sheet Components

After migration is complete and tested:

**Files to Delete**:
- `components/loans/PrepaymentSheet.tsx`
- `components/loans/ManualCorrectionSheet.tsx`
- `components/simulator/EntryEditSheet.tsx`

**Why Delete**:
- No longer used after migration
- Reduces codebase size
- Avoids confusion

### Step 8: Create Route Layout Files

Create `_layout.tsx` files for new route groups:

**File**: `app/loans/[id]/_layout.tsx`
```tsx
import { Stack } from "expo-router";

export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

**File**: `app/simulator/[id]/_layout.tsx`
```tsx
import { Stack } from "expo-router";

export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

**Why This Works**:
- Hides default Expo header (we use custom headers)
- Groups routes logically
- Consistent with existing route structure

## Testing Checklist

- [ ] Prepayment form creates new prepayment correctly
- [ ] Prepayment form edits existing prepayment correctly
- [ ] Prepayment impact calculation works correctly
- [ ] Prepayment preview displays at bottom
- [ ] Correction form creates new correction correctly
- [ ] Correction form edits existing correction correctly
- [ ] Simulator entry form creates new entry correctly
- [ ] Simulator entry form edits existing entry correctly
- [ ] All form validations work (required fields, numeric validation)
- [ ] Keyboard handling works correctly on all forms
- [ ] Dark mode styling works correctly
- [ ] Back navigation works correctly
- [ ] Forms handle edge cases (cancel, errors, network issues)

## Files to Modify

### New Files
- `app/loans/[id]/prepayment.tsx` (new)
- `app/loans/[id]/correction.tsx` (new)
- `app/loans/[id]/_layout.tsx` (new)
- `app/simulator/[id]/entry.tsx` (new)
- `app/simulator/[id]/_layout.tsx` (new)

### Modified Files
- `app/loans/[id].tsx` (remove bottom sheet state, add navigation)
- `app/simulator/[id].tsx` (remove bottom sheet state, add navigation)

### Deleted Files
- `components/loans/PrepaymentSheet.tsx`
- `components/loans/ManualCorrectionSheet.tsx`
- `components/simulator/EntryEditSheet.tsx`
