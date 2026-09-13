const NUTRITION_MEAL_TYPES=['Breakfast','Lunch','Dinner','Snack'];
const NUTRITION_UNIT_LABELS={g:'g',oz:'oz',kg:'kg',lb:'lb',ml:'ml',floz:'fl oz',serving:'serving'};

// Which meal section "+ Add Food" currently targets, and the in-progress quantity
// draft for the selected food — both ephemeral UI state, never persisted, matching
// the existing bjjExpandedCategory-style pattern used elsewhere in the app.
let nutritionTargetMealType='Breakfast';
let nutritionQuantityDraft={quantity:1,unit:'serving'};
let editingMealId=null;

function setNutritionTargetMealType(type){
  nutritionTargetMealType=type;
  window._selectedFood=null;
  render('nutrition');
}
function updateNutritionQuantityDraft(){
  nutritionQuantityDraft={quantity:$('food_quantity')?.value||1,unit:$('food_unit')?.value||'serving'};
  render('nutrition');
}

// fiber/sugar are preserved as null when a source doesn't report them (see foodTotals
// in utils.js) rather than silently becoming a misleading zero.
// food: a search result / favorite / recipe / custom-food record. When it has a
// `basis` (amount+unit its stored nutrient values are FOR), quantity+unit are
// converted through that basis via convertQuantityToBasisMultiplier — never a bare
// "servings" multiplier applied blindly, which was the previous, less accurate
// behavior. Foods without a basis (very old in-memory objects) fall back to that
// legacy behavior unchanged.
function addMealFood(food,quantity,unit,mealType){
  let multiplier,normalizedGrams=null;
  if(food.basis){
    multiplier=convertQuantityToBasisMultiplier(food,quantity,unit);
    if(multiplier===null){toast("That unit isn't available for this food — try grams/oz or servings instead.");return false}
    if(unit==='g') normalizedGrams=ensureNumber(quantity);
    else if(unit==='kg') normalizedGrams=ensureNumber(quantity)*1000;
    else if(unit==='oz') normalizedGrams=ensureNumber(quantity)*28.3495;
    else if(unit==='lb') normalizedGrams=ensureNumber(quantity)*453.592;
    else if(unit==='serving'&&food.servingGrams) normalizedGrams=ensureNumber(quantity)*food.servingGrams;
  }else{
    multiplier=ensureNumber(quantity,1);
    unit='serving';
  }
  if(!Number.isFinite(multiplier)||multiplier<0){toast('Enter a quantity greater than zero');return false}
  const scaled=scaleFoodNutrition(food,multiplier);
  S.meals.push({
    id:uid('meal'),
    date:today(),mealType:mealType||'Snack',
    food:food.name||food.food||'Food',brand:food.brand||'',
    quantity:ensureNumber(quantity),unit,normalizedGrams,
    servingSize:food.servingSize||formatBasisLabel(food),
    servings:multiplier,
    cal:scaled.cal,prot:scaled.prot,carbs:scaled.carbs,fat:scaled.fat,fiber:scaled.fiber,sugar:scaled.sugar,
    source:food.source||'manual',barcode:food.barcode||'',fdcId:food.fdcId||null,
    referenceLabel:formatBasisLabel(food),
    // Snapshot of the food's own per-basis nutrition, so a later quantity edit can
    // rescale without needing to search the database again.
    basisSnapshot:food.basis?{amount:food.basis.amount,unit:food.basis.unit,cal:ensureNumber(food.cal),prot:ensureNumber(food.prot),carbs:ensureNumber(food.carbs),fat:ensureNumber(food.fat),fiber:food.fiber,sugar:food.sugar,servingGrams:food.servingGrams||null,servingMl:food.servingMl||null}:null
  });
  save(); render('nutrition'); toast('Food added');
  return true;
}
async function searchUSDA(q){
  const key=S.settings.usdaKey||'DEMO_KEY';
  const url=`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(q)}&pageSize=20`;
  const r=await fetchWithTimeout(url); if(!r.ok) throw new Error('USDA search failed');
  const j=await r.json();
  return (j.foods||[]).map(f=>({
    name:f.description||'Food',brand:f.brandOwner||f.brandName||'',
    source:'USDA FoodData Central',fdcId:f.fdcId,
    cal:0
  }));
}
function nutrientsFromFdc(f){
  const get=(names)=>{
    const n=(f.foodNutrients||[]).find(x=>names.includes((x.nutrientName||'').toLowerCase()));
    return n?ensureNumber(n.value):0;
  };
  // Fiber/sugar specifically fall back to null (unknown), not 0, when USDA doesn't report them.
  const getOrNull=(names)=>{
    const n=(f.foodNutrients||[]).find(x=>names.includes((x.nutrientName||'').toLowerCase()));
    return n?ensureNumber(n.value):null;
  };
  // USDA reports nutrient values for whatever servingSize/servingSizeUnit is stated
  // on the record (falling back to 100g when absent) — that same amount doubles as
  // "1 serving" for this food, since USDA doesn't separately publish a serving size.
  const rawUnit=(f.servingSizeUnit||'g').toLowerCase();
  const normUnit=(rawUnit==='ml'||rawUnit==='milliliter'||rawUnit==='millilitre')?'ml':'g';
  const amount=Number.isFinite(f.servingSize)&&f.servingSize>0?f.servingSize:100;
  return {
    name:f.description||'Food',
    brand:f.brandOwner||f.brandName||'',
    servingSize:f.servingSize ? `${f.servingSize} ${f.servingSizeUnit||''}`.trim() : '100 g',
    basis:{amount,unit:normUnit},
    servingGrams:normUnit==='g'?amount:null,
    servingMl:normUnit==='ml'?amount:null,
    cal:get(['energy','energy (atwater general factors)','energy (atwater specific factors)']),
    prot:get(['protein']),
    carbs:get(['carbohydrate, by difference']),
    fat:get(['total lipid (fat)']),
    fiber:getOrNull(['fiber, total dietary']),
    sugar:getOrNull(['total sugars']),
    source:'USDA FoodData Central',
    barcode:(f.gtinUpc||'')
  };
}
async function searchOpenFoodFacts(q){
  const url=`https://world.openfoodfacts.org/api/v2/search?categories_tags_en=foods&search_terms=${encodeURIComponent(q)}&page_size=20&fields=code,product_name,brands,serving_size,nutriments`;
  const r=await fetchWithTimeout(url,{headers:{'Accept':'application/json'}});
  if(!r.ok) throw new Error('Open Food Facts search failed');
  const j=await r.json();
  return (j.products||[]).map(p=>{
    // Open Food Facts nutrient fields are always per 100g regardless of the
    // product's own serving_size — that serving_size is parsed SEPARATELY, purely as
    // a convenience "1 serving" shortcut, never used to reinterpret the _100g basis.
    const parsedServing=parseServingSizeString(p.serving_size);
    return {
      name:p.product_name||'Unnamed product',brand:p.brands||'',
      servingSize:p.serving_size||'100 g',barcode:p.code||'',
      basis:{amount:100,unit:'g'},
      servingGrams:parsedServing.unit==='g'?parsedServing.amount:null,
      servingMl:parsedServing.unit==='ml'?parsedServing.amount:null,
      cal:p.nutriments?.['energy-kcal_100g']||0,
      prot:p.nutriments?.proteins_100g||0,
      carbs:p.nutriments?.carbohydrates_100g||0,
      fat:p.nutriments?.fat_100g||0,
      fiber:(p.nutriments&&p.nutriments.fiber_100g!=null)?ensureNumber(p.nutriments.fiber_100g):null,
      sugar:(p.nutriments&&p.nutriments.sugars_100g!=null)?ensureNumber(p.nutriments.sugars_100g):null,
      source:'Open Food Facts'
    };
  });
}
async function lookupBarcode(code){
  const r=await fetchWithTimeout(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}?fields=code,product_name,brands,serving_size,nutriments`);
  if(!r.ok) throw new Error('Barcode lookup failed');
  const j=await r.json(), p=j.product;
  if(!p) throw new Error('Product not found');
  const parsedServing=parseServingSizeString(p.serving_size);
  return {
    name:p.product_name||'Unnamed product',brand:p.brands||'',servingSize:p.serving_size||'100 g',barcode:p.code||code,
    basis:{amount:100,unit:'g'},
    servingGrams:parsedServing.unit==='g'?parsedServing.amount:null,
    servingMl:parsedServing.unit==='ml'?parsedServing.amount:null,
    cal:p.nutriments?.['energy-kcal_100g']||0,prot:p.nutriments?.proteins_100g||0,
    carbs:p.nutriments?.carbohydrates_100g||0,fat:p.nutriments?.fat_100g||0,
    fiber:(p.nutriments&&p.nutriments.fiber_100g!=null)?ensureNumber(p.nutriments.fiber_100g):null,
    sugar:(p.nutriments&&p.nutriments.sugars_100g!=null)?ensureNumber(p.nutriments.sugars_100g):null,
    source:'Open Food Facts'
  };
}
function selectFood(i){
  const f=(window._foodResults||[])[Number(i)];
  if(!f)return;
  window._selectedFood=f;
  nutritionQuantityDraft=f.basis?{quantity:f.basis.amount,unit:f.basis.unit}:{quantity:1,unit:'serving'};
  render('nutrition');
}
function addSelectedFood(){
  if(!window._selectedFood){toast('Select a food first');return}
  const quantity=ensureNumber(nutritionQuantityDraft.quantity,NaN);
  if(!Number.isFinite(quantity)||quantity<=0){toast('Enter a quantity greater than zero');return}
  if(quantity>100000){toast('Enter a realistic quantity');return}
  const ok=addMealFood(window._selectedFood,quantity,nutritionQuantityDraft.unit,nutritionTargetMealType);
  if(ok){window._selectedFood=null}
}
let searchInFlight=false;
async function foodSearch(){
  if(searchInFlight){toast('Still searching…');return}
  const q=$('food_search').value.trim();
  if(!q){toast('Enter a food or brand');return}
  searchInFlight=true;
  const box=$('food_results');
  if(box) box.innerHTML='<div class="muted">Searching…</div>';
  try{
    const [usda,off]=await Promise.allSettled([
      searchUSDA(q),
      searchOpenFoodFacts(q)
    ]);
    const results=[];
    if(usda.status==='fulfilled'){
      const raw=usda.value;
      // Detail fetches run in parallel (not sequentially) to keep search fast.
      const key=S.settings.usdaKey||'DEMO_KEY';
      const details=await Promise.allSettled(raw.slice(0,8).map(item=>
        fetchWithTimeout(`https://api.nal.usda.gov/fdc/v1/food/${item.fdcId}?api_key=${encodeURIComponent(key)}`)
          .then(r=>r.ok?r.json():Promise.reject(new Error('detail fetch failed')))
      ));
      details.forEach(d=>{ if(d.status==='fulfilled') results.push(nutrientsFromFdc(d.value)); });
    }
    if(off.status==='fulfilled') results.push(...off.value.slice(0,12));
    window._foodResults=results;
    render('nutrition');
    if(!results.length) toast('No results found — try a brand or barcode');
  }catch(e){if(box) box.innerHTML='<div class="muted">Food search failed. Check your connection or API settings.</div>'}
  finally{searchInFlight=false}
}
let lastBarcodeError='';
async function barcodeSearch(){
  const code=$('barcode').value.trim();
  if(!code){toast('Enter a barcode');return}
  lastBarcodeError='';
  try{
    window._selectedFood=await lookupBarcode(code);
    nutritionQuantityDraft=window._selectedFood.basis?{quantity:window._selectedFood.basis.amount,unit:window._selectedFood.basis.unit}:{quantity:1,unit:'serving'};
    render('nutrition');
    toast('Barcode found');
  }catch(e){
    lastBarcodeError='No product found for that barcode. Try search, or add it as a custom food below.';
    render('nutrition');
    toast('Product not found');
  }
}
function saveFavorite(){
  if(!window._selectedFood){toast('Select a food first');return}
  S.foodFavorites=S.foodFavorites||[];
  S.foodFavorites.unshift(window._selectedFood);
  save(); render('nutrition'); toast('Saved to favorites');
}
function addFavorite(i){
  const f=S.foodFavorites[Number(i)];
  if(!f)return;
  const quantity=f.basis?f.basis.amount:1, unit=f.basis?f.basis.unit:'serving';
  addMealFood(f,quantity,unit,nutritionTargetMealType);
}
function removeFavorite(i){
  S.foodFavorites.splice(Number(i),1); save(); render('nutrition'); toast('Removed from favorites');
}
function deleteMeal(id){S.meals=S.meals.filter(x=>String(x.id)!==String(id));save();render('nutrition')}
function startEditMeal(id){editingMealId=(editingMealId===id)?null:id; render('nutrition');}
function saveEditMeal(id){
  const m=(S.meals||[]).find(x=>String(x.id)===String(id));
  if(!m){editingMealId=null;render('nutrition');return}
  const quantity=ensureNumber($(`edit_qty_${id}`)?.value,NaN);
  const unit=$(`edit_unit_${id}`)?.value||m.unit;
  if(!Number.isFinite(quantity)||quantity<=0){toast('Enter a quantity greater than zero');return}
  if(!m.basisSnapshot){toast("This entry can't be rescaled (logged before quantity editing existed) — delete and re-log it instead.");return}
  const fakeFood={basis:{amount:m.basisSnapshot.amount,unit:m.basisSnapshot.unit},servingGrams:m.basisSnapshot.servingGrams,servingMl:m.basisSnapshot.servingMl,cal:m.basisSnapshot.cal,prot:m.basisSnapshot.prot,carbs:m.basisSnapshot.carbs,fat:m.basisSnapshot.fat,fiber:m.basisSnapshot.fiber,sugar:m.basisSnapshot.sugar};
  const multiplier=convertQuantityToBasisMultiplier(fakeFood,quantity,unit);
  if(multiplier===null){toast("That unit isn't available for this food.");return}
  const scaled=scaleFoodNutrition(fakeFood,multiplier);
  m.quantity=quantity; m.unit=unit; m.servings=multiplier;
  m.cal=scaled.cal;m.prot=scaled.prot;m.carbs=scaled.carbs;m.fat=scaled.fat;m.fiber=scaled.fiber;m.sugar=scaled.sugar;
  editingMealId=null;
  save();render('nutrition');toast('Updated');
}

// ---- Custom foods: persisted as favorites (source:'Custom') so they reuse the same
// storage, sync, and re-add mechanism rather than a second food database. ----
function createCustomFood(){
  const name=($('cf_name').value||'').trim();
  if(!name){toast('Name the food');return}
  const cal=ensureNumber($('cf_cal').value,NaN);
  if(!Number.isFinite(cal)||cal<0){toast('Enter a valid calorie amount (0 or more)');return}
  const num0=(id)=>{const n=ensureNumber($(id).value,NaN);return (Number.isFinite(n)&&n>=0)?n:0};
  const numOrUnknown=(id)=>{
    const raw=($(id).value||'').trim();
    if(raw==='') return null;
    const n=ensureNumber(raw,NaN);
    return (Number.isFinite(n)&&n>=0)?n:'invalid';
  };
  const prot=num0('cf_prot'), carbs=num0('cf_carbs'), fat=num0('cf_fat');
  const fiber=numOrUnknown('cf_fiber'), sugar=numOrUnknown('cf_sugar');
  if(fiber==='invalid'||sugar==='invalid'){toast('Fiber/sugar must be zero or more, or left blank');return}
  const servingSize=($('cf_serving').value||'').trim()||'1 serving';
  // Custom foods are logged in servings only — there's no reliable structured
  // weight/volume for a free-text serving description, so no unit conversion is
  // offered rather than guessing one.
  S.foodFavorites.unshift({name,brand:'',servingSize,basis:{amount:1,unit:'serving'},servingGrams:null,servingMl:null,cal,prot,carbs,fat,fiber,sugar,source:'Custom'});
  save();render('nutrition');toast('Custom food saved');
}

// ---- Recipes: a simple ingredient draft builder. Totals are always derived via the
// existing foodTotals() helper — never a separate calculation. ----
let recipeDraftIngredients=[];
function addRecipeIngredient(){
  const name=($('ing_name').value||'').trim();
  const cal=ensureNumber($('ing_cal').value,NaN);
  if(!name||!Number.isFinite(cal)||cal<0){toast('Enter an ingredient name and valid calories');return}
  const qty=Math.max(0.01,ensureNumber($('ing_qty').value,1));
  recipeDraftIngredients.push({
    food:name,
    cal:cal*qty,
    prot:ensureNumber($('ing_prot').value,0)*qty,
    carbs:ensureNumber($('ing_carbs').value,0)*qty,
    fat:ensureNumber($('ing_fat').value,0)*qty,
    fiber:null,sugar:null
  });
  render('nutrition');
  toast('Ingredient added');
}
function removeRecipeIngredient(i){recipeDraftIngredients.splice(Number(i),1);render('nutrition')}
function saveRecipeDraft(){
  const name=($('recipe_name').value||'').trim();
  if(!name||!recipeDraftIngredients.length){toast('Name the recipe and add at least one ingredient');return}
  const t=foodTotals(recipeDraftIngredients);
  S.foodRecipes.unshift({
    id:uid('recipe'),name,ingredients:recipeDraftIngredients.slice(),
    basis:{amount:1,unit:'serving'},servingGrams:null,servingMl:null,
    cal:t.cal,prot:t.prot,carbs:t.carbs,fat:t.fat,
    fiber:t.fiberKnownCount>0?t.fiber:null,
    sugar:t.sugarKnownCount>0?t.sugar:null
  });
  recipeDraftIngredients=[];
  save();render('nutrition');toast('Recipe saved');
}
function logRecipe(i){
  const r=(S.foodRecipes||[])[Number(i)];
  if(!r)return;
  addMealFood({name:r.name,cal:r.cal,prot:r.prot,carbs:r.carbs,fat:r.fat,fiber:r.fiber,sugar:r.sugar,source:'Recipe',basis:r.basis||{amount:1,unit:'serving'}},1,'serving',nutritionTargetMealType);
}
function renderFoodResults(){
  const results=window._foodResults||[];
  if(!results.length) return '';
  return `<p class="small muted" style="margin:8px 0 0">Database values from USDA/Open Food Facts — treat as an estimate, not a guaranteed match to any specific product label.</p><div class="list">${results.map((f,i)=>`<div class="item"><b>${esc(f.name)}</b>${f.brand?` <span class="small muted">(${esc(f.brand)})</span>`:''} <span class="pill">${esc(f.source||'')}</span><div class="small muted">per ${esc(formatBasisLabel(f))} · ${Math.round(ensureNumber(f.cal))} cal · P ${Math.round(ensureNumber(f.prot))}g · C ${Math.round(ensureNumber(f.carbs))}g · F ${Math.round(ensureNumber(f.fat))}g · Fiber ${formatOptionalGrams(f.fiber)} · Sugar ${formatOptionalGrams(f.sugar)}</div><button class="btn secondary" style="margin-top:6px" onclick="selectFood(${i})">Select</button></div>`).join('')}</div>`;
}
function renderSelectedFood(){
  const f=window._selectedFood;
  if(!f) return '';
  const isDatabase=f.source&&f.source!=='manual'&&f.source!=='Custom'&&f.source!=='Recipe';
  const units=availableUnitsForFood(f);
  const multiplier=convertQuantityToBasisMultiplier(f,nutritionQuantityDraft.quantity,nutritionQuantityDraft.unit);
  const preview=multiplier!==null?scaleFoodNutrition(f,multiplier):null;
  return `<div class="card" style="margin-top:10px"><h4 style="margin:0 0 4px">${esc(f.name)}</h4><div class="small muted">Per ${esc(formatBasisLabel(f))} · Source: ${esc(f.source||'manual')} · Logging into <b>${esc(nutritionTargetMealType)}</b></div>
${isDatabase?'<p class="small muted" style="margin:6px 0">Database value — not guaranteed to match this exact product\'s label. If you have the label in front of you, use "Add a custom food" below instead.</p>':''}
<div class="small" style="margin-top:6px">Per ${esc(formatBasisLabel(f))}: ${Math.round(ensureNumber(f.cal))} cal · P ${Math.round(ensureNumber(f.prot))}g · C ${Math.round(ensureNumber(f.carbs))}g · F ${Math.round(ensureNumber(f.fat))}g · Fiber ${formatOptionalGrams(f.fiber)} · Sugar ${formatOptionalGrams(f.sugar)}</div>
<div class="row" style="margin-top:8px;align-items:center">
<label class="small">Quantity<input id="food_quantity" class="input" style="max-width:100px" type="number" min="0" step="any" value="${esc(nutritionQuantityDraft.quantity)}" onchange="updateNutritionQuantityDraft()"></label>
<label class="small">Unit<select id="food_unit" class="input" style="max-width:120px" onchange="updateNutritionQuantityDraft()">${units.map(u=>`<option value="${u}" ${nutritionQuantityDraft.unit===u?'selected':''}>${NUTRITION_UNIT_LABELS[u]}</option>`).join('')}</select></label>
</div>
${preview?`<div class="small muted" style="margin-top:6px">= ${Math.round(preview.cal)} cal · P ${Math.round(preview.prot)}g · C ${Math.round(preview.carbs)}g · F ${Math.round(preview.fat)}g · Fiber ${formatOptionalGrams(preview.fiber)} · Sugar ${formatOptionalGrams(preview.sugar)}</div>`:`<p class="small" style="margin-top:6px">That unit isn't available for this food — mass and volume can't be converted without knowing this food's density. Try grams/oz or servings instead.</p>`}
<div class="row" style="margin-top:8px;align-items:center"><button class="btn" onclick="addSelectedFood()">Log to ${esc(nutritionTargetMealType)}</button><button class="btn secondary" onclick="saveFavorite()">Save to favorites</button></div>
</div>`;
}
function renderMealTypeSection(type,meals){
  const items=meals.filter(x=>x.mealType===type);
  const t=foodTotals(items);
  return `<div class="card" style="margin-top:10px">
<div class="row" style="justify-content:space-between;align-items:center"><h4 style="margin:0">${type}</h4><button class="btn secondary" onclick="setNutritionTargetMealType('${type}')">+ Add Food</button></div>
${items.length?`<div class="small muted" style="margin-top:4px">${Math.round(t.cal)} cal · P ${Math.round(t.prot)}g · C ${Math.round(t.carbs)}g · F ${Math.round(t.fat)}g</div>`:''}
${items.length?items.map(x=>`<div class="item"><b>${esc(x.food)}</b>${x.source&&x.source!=='manual'?` <span class="pill">${esc(x.source)}</span>`:''}<div class="small muted">${esc(x.quantity)} ${esc(NUTRITION_UNIT_LABELS[x.unit]||x.unit)}${x.referenceLabel?` (ref: ${esc(x.referenceLabel)})`:''}</div><div class="small muted">${Math.round(ensureNumber(x.cal))} cal · P ${Math.round(ensureNumber(x.prot))}g · C ${Math.round(ensureNumber(x.carbs))}g · F ${Math.round(ensureNumber(x.fat))}g · Fiber ${formatOptionalGrams(x.fiber)} · Sugar ${formatOptionalGrams(x.sugar)}</div>
${editingMealId===x.id?`<div class="row" style="margin-top:6px;align-items:center"><input id="edit_qty_${x.id}" class="input" style="max-width:100px" type="number" min="0" step="any" value="${esc(x.quantity)}"><select id="edit_unit_${x.id}" class="input" style="max-width:120px">${NUTRITION_UNITS.map(u=>`<option value="${u}" ${x.unit===u?'selected':''}>${NUTRITION_UNIT_LABELS[u]}</option>`).join('')}</select><button class="btn secondary" onclick="saveEditMeal('${x.id}')">Save</button></div>`
:`<div class="row" style="margin-top:6px"><button class="btn secondary" onclick="startEditMeal('${x.id}')">Edit</button><button class="btn secondary" onclick="deleteMeal(${JSON.stringify(String(x.id))})">Remove</button></div>`}
</div>`).join(''):'<div class="empty">Nothing logged yet.</div>'}
</div>`;
}

views.nutrition=()=>{
  let p=S.profile;
  const m=S.meals.filter(x=>x.date===today());
  const mt=foodTotals(m);
  const weekTrend=weeklyNutritionTrend(S.meals,today());
  const calRemaining=p.cal-mt.cal, protRemaining=p.protein-mt.prot;
  return `<p class="page-intro">Real quantities and real sources — a serving is never a flat multiplier standing in for what you actually ate.</p>
<div class="grid four">
<div class="card"><div class="small">Calories</div><div class="metric">${Math.round(mt.cal)}<span class="unit">/${p.cal}</span></div><div class="small muted">${calRemaining>=0?`${Math.round(calRemaining)} remaining`:`${Math.round(-calRemaining)} over`}</div><div class="barbg" style="margin-top:8px"><div class="bar" style="width:${pct(mt.cal,p.cal)}%"></div></div></div>
<div class="card"><div class="small">Protein</div><div class="metric">${Math.round(mt.prot)}g<span class="unit">/${p.protein}g</span></div><div class="small muted">${protRemaining>=0?`${Math.round(protRemaining)}g remaining`:`${Math.round(-protRemaining)}g over`}</div><div class="barbg" style="margin-top:8px"><div class="bar" style="width:${pct(mt.prot,p.protein)}%"></div></div></div>
<div class="card"><div class="small">Carbs</div><div class="metric">${Math.round(mt.carbs)}g<span class="unit">/${p.carbs}g</span></div><div class="barbg" style="margin-top:8px"><div class="bar" style="width:${pct(mt.carbs,p.carbs)}%"></div></div></div>
<div class="card"><div class="small">Fat</div><div class="metric">${Math.round(mt.fat)}g<span class="unit">/${p.fat}g</span></div><div class="barbg" style="margin-top:8px"><div class="bar" style="width:${pct(mt.fat,p.fat)}%"></div></div></div>
</div>
<div class="grid two" style="margin-top:12px">
<div class="card"><div class="small">Fiber today</div><div class="metric">${m.length?(mt.fiberKnownCount>0?`${mt.fiber.toFixed(1)}g`:'—'):'—'}</div><div class="small muted">${mt.fiberUnknownCount>0?`${mt.fiberUnknownCount} food${mt.fiberUnknownCount===1?'':'s'} didn't report fiber`:'No target set — tracked for information only'}</div></div>
<div class="card"><div class="small">Sugar today</div><div class="metric">${m.length?(mt.sugarKnownCount>0?`${mt.sugar.toFixed(1)}g`:'—'):'—'}</div><div class="small muted">${mt.sugarUnknownCount>0?`${mt.sugarUnknownCount} food${mt.sugarUnknownCount===1?'':'s'} didn't report sugar`:'No target set — tracked for information only'}</div></div>
</div>

<h3 class="section">Today's meals</h3>
${NUTRITION_MEAL_TYPES.map(type=>renderMealTypeSection(type,m)).join('')}

<h3 class="section">Search foods</h3>
<div class="card"><div class="small muted" style="margin-bottom:6px">Adding to: <b>${esc(nutritionTargetMealType)}</b> <span class="row" style="display:inline-flex;gap:4px">${NUTRITION_MEAL_TYPES.map(t=>`<button class="btn ${nutritionTargetMealType===t?'':'secondary'} qty-btn" style="min-width:auto;padding:4px 8px" onclick="setNutritionTargetMealType('${t}')">${t[0]}</button>`).join('')}</span></div>
<div class="row"><input id="food_search" class="input" placeholder="Search a food or brand" style="flex:1 1 200px"><button class="btn" onclick="foodSearch()">Search</button></div>
<div id="food_results">${renderFoodResults()}</div>
</div>
${renderSelectedFood()}

<h3 class="section">Barcode lookup</h3>
<div class="card"><p class="small muted" style="margin:0 0 8px">Manual entry only — this app can't use your camera as a scanner. Type the barcode number printed on the package.</p><div class="row"><input id="barcode" class="input" style="max-width:220px" inputmode="numeric" placeholder="Barcode number"><button class="btn" onclick="barcodeSearch()">Look up</button></div>${lastBarcodeError?`<p class="small" style="margin-top:8px">${esc(lastBarcodeError)}</p>`:''}</div>

<h3 class="section">Add a custom food</h3>
<div class="card"><p class="small muted" style="margin:0 0 8px">For a food you can't find, or when you have the exact label in hand. Custom foods are logged in servings.</p>
<div class="grid three"><input id="cf_name" class="input" placeholder="Food name"><input id="cf_cal" class="input" type="number" inputmode="decimal" placeholder="Calories"><input id="cf_serving" class="input" placeholder="Serving size (e.g. 1 cup)"></div>
<div class="grid four" style="margin-top:8px"><input id="cf_prot" class="input" type="number" inputmode="decimal" placeholder="Protein (g)"><input id="cf_carbs" class="input" type="number" inputmode="decimal" placeholder="Carbs (g)"><input id="cf_fat" class="input" type="number" inputmode="decimal" placeholder="Fat (g)"><input id="cf_fiber" class="input" type="number" inputmode="decimal" placeholder="Fiber (g, optional)"></div>
<div class="grid two" style="margin-top:8px"><input id="cf_sugar" class="input" type="number" inputmode="decimal" placeholder="Sugar (g, optional)"><button class="btn" onclick="createCustomFood()">Save custom food</button></div>
</div>

<h3 class="section">Favorites</h3>
<div class="card">${(S.foodFavorites||[]).map((f,i)=>`<div class="item"><b>${esc(f.name)}</b>${f.source?` <span class="pill">${esc(f.source)}</span>`:''}<div class="small muted">${esc(formatBasisLabel(f))} · ${Math.round(ensureNumber(f.cal))} cal · P ${Math.round(ensureNumber(f.prot))}g</div><div class="row" style="margin-top:6px"><button class="btn secondary" onclick="addFavorite(${i})">+ Add to ${esc(nutritionTargetMealType)}</button><button class="btn danger" onclick="removeFavorite(${i})">Remove</button></div></div>`).join('')||'<div class="empty">No favorites yet — save a searched food or custom food to see it here.</div>'}</div>

<h3 class="section">Recipes</h3>
<div class="card">
<h4 style="margin:0 0 8px">Build a recipe</h4>
<div class="grid three"><input id="ing_name" class="input" placeholder="Ingredient name"><input id="ing_cal" class="input" type="number" inputmode="decimal" placeholder="Calories"><input id="ing_qty" class="input" type="number" inputmode="decimal" placeholder="Qty" value="1"></div>
<div class="grid three" style="margin-top:8px"><input id="ing_prot" class="input" type="number" inputmode="decimal" placeholder="Protein (g)"><input id="ing_carbs" class="input" type="number" inputmode="decimal" placeholder="Carbs (g)"><input id="ing_fat" class="input" type="number" inputmode="decimal" placeholder="Fat (g)"></div>
<button class="btn secondary" style="margin-top:9px" onclick="addRecipeIngredient()">+ Add ingredient</button>
${recipeDraftIngredients.length?`<div class="list">${recipeDraftIngredients.map((x,i)=>`<div class="item"><b>${esc(x.food)}</b> · ${Math.round(x.cal)} cal · ${Math.round(x.prot)}g P <button class="btn secondary" onclick="removeRecipeIngredient(${i})">×</button></div>`).join('')}</div><div class="row" style="margin-top:9px"><input id="recipe_name" class="input" placeholder="Recipe name"><button class="btn" onclick="saveRecipeDraft()">Save recipe</button></div>`:'<p class="muted" style="margin-top:8px">Add at least one ingredient to save a recipe.</p>'}
</div>
<div class="card" style="margin-top:10px">${(S.foodRecipes||[]).map((r,i)=>{
  const ingredientNames=r.ingredients?r.ingredients.map(x=>x.food).join(', '):(r.foods||[]).join(', ');
  return `<div class="item"><b>${esc(r.name)}</b> · ${Math.round(r.cal||0)} cal · ${Math.round(r.prot||0)}g P<div class="small muted">${esc(ingredientNames)}</div><button class="btn secondary" style="margin-top:6px" onclick="logRecipe(${i})">Log to ${esc(nutritionTargetMealType)}</button></div>`;
}).join('')||'<div class="empty">No recipes yet.</div>'}</div>

<h3 class="section">Weekly nutrition trend</h3>
<div class="card">${weekTrend?`<div class="grid four"><div><div class="small">Avg calories</div><div class="metric">${Math.round(weekTrend.avgCal)}</div></div><div><div class="small">Avg protein</div><div class="metric">${Math.round(weekTrend.avgProt)}g</div></div><div><div class="small">Avg carbs</div><div class="metric">${Math.round(weekTrend.avgCarbs)}g</div></div><div><div class="small">Avg fat</div><div class="metric">${Math.round(weekTrend.avgFat)}g</div></div></div><div class="small muted" style="margin-top:8px">Based on ${weekTrend.daysLogged} of the last 7 days with food logged.</div>`:'<div class="empty">Log meals on a few different days to see your weekly average.</div>'}</div>`;
};
