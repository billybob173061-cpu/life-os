const KEY='lifeos-final-v1';
// ---- Pre-populated BJJ curriculum (v1.1). Raw, compact seed data — mapped into full
// technique records (with id/confidence/status/etc. defaults) by seedBjjTechniques()
// below. Level tags a beginner's natural priority order; they are not a claim about
// how long any individual takes to learn a given technique.
const BJJ_SEED_RAW=[
// ---- POSITIONS ----
['Standing','positions','Standing','Foundation','Neutral standing position before a takedown or guard pull.',['Stance','Base']],
['Closed Guard','positions','Closed Guard','Foundation','Legs locked around the opponent’s waist from the bottom.',['Control','Attack options']],
['Open Guard','positions','Open Guard','Foundation','Guard without locking the legs, using frames and hooks for control.',['Frames','Hooks']],
['Half Guard','positions','Half Guard','Foundation','One of the opponent’s legs trapped between yours.',['Underhook','Knee shield']],
['Side Control','positions','Side Control','Foundation','Perpendicular pinning position on top.',['Crossface','Hip pressure']],
['Mount','positions','Mount','Foundation','Top position straddling the opponent’s torso.',['Base','Posture']],
['Knee-on-Belly','positions','Knee-on-Belly','Developing','Transitional pressure position with one knee across the torso.',['Mobility','Pressure']],
['North-South','positions','North-South','Developing','Top control facing the opposite direction from the opponent’s head.',['Head control','Pressure']],
['Back Control','positions','Back Control','Intermediate','Controlling the opponent from behind with hooks or a body triangle.',['Hooks','Seatbelt']],
['Turtle','positions','Turtle','Foundation','Defensive position on hands and knees.',['Base','Protecting the neck']],
['Butterfly Guard','positions','Butterfly Guard','Developing','Seated guard hooking inside the opponent’s thighs.',['Hooks','Elevation']],
['De La Riva Guard','positions','De La Riva','Intermediate','Open guard hooking the outside of the opponent’s leg.',['Hook','Off-balancing']],
['Reverse De La Riva','positions','Reverse De La Riva','Advanced','Guard variation hooking the far leg from the inside.',['Hook','Angle']],
['Single-Leg X','positions','Single-Leg X','Intermediate','Guard controlling one of the opponent’s legs between yours.',['Leg control','Off-balancing']],
['X-Guard','positions','X-Guard','Advanced','Deep leg-entanglement guard used for sweeps.',['Elevation','Sweep entries']],
['50/50 Guard','positions','50/50 Guard','Advanced','Symmetrical leg-entanglement position.',['Leg control','Heel exposure awareness']],
// ---- CONTROLS ----
['Base','controls','Base','Foundation','Maintaining balance and a stable center of gravity.',['Balance']],
['Posture','controls','Posture','Foundation','Keeping the spine aligned to resist submissions and sweeps.',['Spine alignment']],
['Frames','controls','Frames','Foundation','Using bones (forearm, shin) to create and hold space.',['Space creation']],
['Pressure','controls','Pressure','Developing','Using body weight to limit the opponent’s movement.',['Weight distribution']],
['Connection','controls','Connection','Developing','Keeping your body connected to the opponent’s to control without gaps.',['No gaps']],
['Underhooks','controls','Underhooks','Foundation','Arm placed under the opponent’s arm for control and off-balancing.',['Off-balancing']],
['Overhooks','controls','Overhooks','Developing','Arm placed over the opponent’s arm, often setting up kimura-style control.',['Kimura setups']],
['Crossface','controls','Crossface','Developing','Cross-facing control from side control or turtle.',['Head control']],
['Wrist Control','controls','Wrist Control','Foundation','Controlling the opponent’s wrist to limit their frames and grips.',['Grip control']],
['Two-on-One','controls','Two-on-One','Developing','Controlling one of the opponent’s arms with both of yours.',['Arm isolation']],
['Seatbelt Control','controls','Seatbelt','Intermediate','Standard back-control grip: one arm over the shoulder, one under the arm.',['Back control basics']],
['Leg Control','controls','Leg Control','Developing','Controlling the opponent’s legs to prevent guard recovery or set up entanglements.',['Leg pummeling']],
['Mount Control','controls','Mount Control','Foundation','Maintaining mount using grapevines and high-mount concepts.',['Grapevines','High mount']],
['Side Control Pinning','controls','Side Control','Foundation','Chest-to-chest pinning concepts specific to side control.',['Chest-to-chest pressure']],
// ---- ESCAPES ----
['Mount Bridge & Roll (Upa)','escapes','Mount Escapes','Foundation','Bridging escape from bottom mount.',['Bridge','Hip explosion']],
['Mount Elbow Escape (Shrimp)','escapes','Mount Escapes','Foundation','Hip-escape based mount escape to recover guard.',['Shrimping','Frames']],
['Mount Trap-and-Roll','escapes','Mount Escapes','Developing','Trapping an arm and rolling to reverse mount.',['Arm trap','Bridge']],
['Side Control Frame Escape','escapes','Side Control Escapes','Foundation','Creating a frame to make space and recover guard from side control.',['Frames']],
['Side Control Hip Escape','escapes','Side Control Escapes','Foundation','Shrimping out from under side control.',['Shrimping']],
['Side Control Underhook Escape','escapes','Side Control Escapes','Developing','Fighting for an underhook to recover to guard or take the back.',['Underhook']],
['North-South Escape','escapes','North-South Escapes','Intermediate','Escaping north-south pressure back to guard.',['Frames','Hip movement']],
['Knee-on-Belly Escape','escapes','Knee-on-Belly Escapes','Developing','Escaping knee-on-belly before it advances to mount.',['Hip movement']],
['Back Escape (Hip Heist)','escapes','Back Escapes','Intermediate','Removing hooks and clearing to guard from back control.',['Hook removal']],
['Turtle Recovery to Guard','escapes','Turtle Escapes','Developing','Rolling or shooting back to guard from turtle.',['Rolling']],
['Guard Recovery (General)','escapes','Guard Recovery','Foundation','General principles for recovering guard when passed.',['Frames','Hip movement']],
['Half Guard Recovery','escapes','Half Guard Recovery','Developing','Recovering a better position from bottom half guard.',['Knee shield']],
['Technical Stand-up','escapes','Guard Recovery','Foundation','Standing up safely from the bottom while managing distance.',['Base','Distance management']],
// ---- TAKEDOWNS / STANDING ----
['Stance','takedowns','Stance & Movement','Foundation','Athletic stance balancing offense and defense.',['Balance']],
['Movement & Footwork','takedowns','Stance & Movement','Foundation','Circling and stepping without crossing feet.',['Footwork']],
['Level Change','takedowns','Level Change','Foundation','Dropping levels safely before a shot.',['Hip drop']],
['Penetration Step','takedowns','Level Change','Developing','Explosive step to close distance for a shot.',['Explosiveness']],
['Single Leg Takedown','takedowns','Shots/Entries','Developing','Attacking one of the opponent’s legs.',['Level change','Finish']],
['Double Leg Takedown','takedowns','Shots/Entries','Developing','Attacking both of the opponent’s legs.',['Level change','Drive']],
['Body Lock (Standing)','takedowns','Clinch/Body Lock','Intermediate','Locking around the opponent’s torso to off-balance and take down.',['Clinch control']],
['Snapdown','takedowns','Shots/Entries','Intermediate','Pulling the head down to create a scramble or back exposure.',['Head control']],
['Arm Drag','takedowns','Shots/Entries','Intermediate','Pulling an arm across to get to the back or a dominant angle.',['Angle change']],
['Rear Body Lock / Trip','takedowns','Trips & Throws','Advanced','Taking the back clinch to a trip takedown.',['Off-balancing']],
['Basic Hip Throw','takedowns','Trips & Throws','Advanced','Fundamental hip-throw concept (o-goshi style).',['Kuzushi','Loading']],
['Sprawl (Takedown Defense)','takedowns','Takedown Defense','Foundation','Defending a shot by driving hips back and down.',['Hip pressure']],
['Underhook Defense (Standing)','takedowns','Takedown Defense','Developing','Fighting for underhooks to prevent being controlled.',['Underhooks']],
['Guard Pull','takedowns','Guard Pull','Foundation','Deliberately going to guard instead of engaging standing.',['Grip fighting']],
// ---- GUARD ----
['Guard Retention (General)','guard','Guard Retention','Foundation','General hip-movement principles to keep guard from being passed.',['Hip movement','Frames']],
['Closed Guard Attack Overview','guard','Closed Guard','Foundation','How closed guard sets up sweeps and submissions.',['Grip breaking']],
['Open Guard Frames & Grips','guard','Open Guard','Developing','Using frames and sleeve/collar grips to control distance.',['Grips']],
['Half Guard Knee Shield','guard','Half Guard','Developing','Using the shin as a frame to prevent the pass and create sweeps.',['Knee shield']],
['Butterfly Guard Hooks & Sweeps','guard','Butterfly Guard','Developing','Using butterfly hooks to elevate and sweep.',['Elevation']],
['Butterfly Half Guard','guard','Half Guard','Intermediate','Hybrid position combining butterfly hook with half guard.',['Hybrid control']],
['De La Riva Sweeps & Entries','guard','De La Riva','Intermediate','Entering and sweeping from De La Riva hook.',['Off-balancing']],
['Single-Leg X Sweeps','guard','Single-Leg X','Intermediate','Sweeping from single-leg X control.',['Leg control']],
['X-Guard Sweeps','guard','X-Guard','Advanced','Sweeping from deep X-guard entanglement.',['Elevation']],
['Seated Guard','guard','Seated Guard','Developing','Seated guard concepts for grip fighting and entries.',['Grip fighting']],
['Off-Balancing (Kuzushi)','guard','Off-Balancing','Foundation','Breaking the opponent’s base before a sweep.',['Timing']],
['Basic Scissor Sweep','guard','Closed Guard','Foundation','Classic closed-guard sweep using a scissoring leg motion.',['Off-balancing']],
['Basic Hip Bump Sweep','guard','Closed Guard','Foundation','Sitting up into the opponent to sweep to mount.',['Timing']],
['Flower Sweep (Pendulum)','guard','Closed Guard','Developing','Pendulum-style sweep from closed guard.',['Momentum']],
// ---- PASSING ----
['Standing Pass Fundamentals','passing','Passing Fundamentals','Foundation','General principles for passing guard from standing.',['Grip fighting','Distance']],
['Knee-Cut Pass','passing','Knee-Cut','Developing','Cutting the knee across to a dominant angle on the pass.',['Angle', 'Pressure']],
['Toreando Pass','passing','Toreando','Developing','Bullfighter-style pass controlling the legs and stepping around.',['Leg control']],
['Leg Drag Pass','passing','Leg Drag','Intermediate','Dragging the near leg across to take the back or side control.',['Angle change']],
['Body-Lock Pass','passing','Body-Lock Pass','Intermediate','Locking around the opponent’s body to pressure-pass.',['Pressure']],
['Over-Under Pass','passing','Over-Under','Developing','One arm over, one arm under the opponent’s legs while passing.',['Pressure']],
['Smash Pass','passing','Smash Pass','Advanced','Heavy chest-to-chest pressure pass.',['Pressure']],
['Half-Guard Passing (General)','passing','Half-Guard Passing','Developing','General concepts for passing from inside half guard.',['Underhook fighting']],
['Headquarters Position','passing','Headquarters','Advanced','Advanced passing position countering leg entanglements.',['Leg control']],
['Passing Closed Guard','passing','Passing Closed Guard','Foundation','Standing up and opening closed guard safely.',['Posture']],
['Passing Open Guard (General)','passing','Passing Open Guard','Developing','General framework for dealing with open guard.',['Grip fighting']],
['Passing Butterfly Guard','passing','Passing Butterfly','Intermediate','Flattening and passing butterfly hooks.',['Base lowering']],
['Passing Leg Entanglements','passing','Passing Leg Entanglements','Advanced','Escaping and passing from inside leg entanglements.',['Leg control']],
['Pressure Passing Concepts','passing','Pressure Passing','Intermediate','Using weight distribution to flatten and pass.',['Weight distribution']],
['Mobility Passing Concepts','passing','Mobility Passing','Intermediate','Using speed and angles instead of pressure to pass.',['Angles','Speed']],
// ---- SUBMISSIONS ----
['Rear Naked Choke','submissions','Chokes','Foundation','Choke from the back using the collar/arm around the neck.',['Back control','Seatbelt']],
['Guillotine Choke','submissions','Chokes','Foundation','Front headlock choke available from many positions.',['Head control']],
['Armbar','submissions','Arm Attacks','Foundation','Hyperextension attack on the elbow, commonly from guard or mount.',['Arm isolation','Hip position']],
['Triangle Choke','submissions','Chokes','Developing','Choke using the legs from guard.',['Angle', 'Leg control']],
['Kimura','submissions','Arm Attacks','Foundation','Shoulder lock using a figure-four grip on the wrist.',['Grip', 'Angle']],
['Americana','submissions','Arm Attacks','Foundation','Shoulder lock attacking the arm bent at 90 degrees, usually from mount/side control.',['Grip']],
['Straight Ankle Lock','submissions','Leg Attacks','Developing','Foundational leg lock attacking the ankle.',['Leg control']],
['Bow-and-Arrow Choke','submissions','Chokes','Intermediate','Powerful choke from the back using the collar and leg.',['Back control']],
['Ezekiel Choke','submissions','Chokes','Developing','Sleeve-based choke available from mount or guard.',['Grip']],
['D’Arce Choke','submissions','Chokes','Intermediate','Arm-and-neck choke often set up from front headlock/scrambles.',['Head control']],
['Anaconda Choke','submissions','Chokes','Intermediate','Arm-and-neck choke rolled to finish, often from turtle.',['Head control']],
['Arm Triangle Choke','submissions','Chokes','Intermediate','Choke using the shoulder and arm against the neck, often from side control.',['Head control','Pressure']],
['Omoplata','submissions','Arm Attacks','Intermediate','Shoulder lock using the legs from guard.',['Leg control','Angle']],
['Kneebar','submissions','Leg Attacks','Advanced','Leg lock hyperextending the knee.',['Leg control']],
['Toe Hold','submissions','Leg Attacks','Advanced','Leg lock attacking the ankle/foot rotation.',['Grip']],
['Heel Hook (Concepts)','submissions','Leg Attacks','Advanced','High-risk leg lock attacking the knee via rotation — learn under direct supervision with controlled partners before drilling live.',['Leg control','Safety awareness']],
// ---- TRANSITIONS ----
['Guard-to-Mount Transition','transitions','Position-to-Position','Developing','Advancing from guard/half guard to mount.',['Hip movement']],
['Side Control-to-Mount Transition','transitions','Position-to-Position','Developing','Advancing from side control to mount.',['Base']],
['Back-Take from Turtle','transitions','Position-to-Position','Intermediate','Taking the back when the opponent turtles.',['Hooks']],
['Sweep-to-Pass Transition','transitions','Sweep-to-Pass','Advanced','Chaining a sweep directly into a pass.',['Momentum']],
['Escape-to-Standing Transition','transitions','Escape-to-Stand','Developing','Escaping bottom position directly to standing.',['Base']],
['Submission Chains (Concept)','transitions','Submission Chains','Advanced','Flowing between related submissions when one is defended.',['Chaining attacks']],
['Scramble Concepts','transitions','Scramble Concepts','Intermediate','General principles for staying safe and opportunistic in scrambles.',['Awareness']],
['Mount-to-Back-Take','transitions','Position-to-Position','Intermediate','Taking the back when the opponent turns from mount.',['Hooks']],
// ---- DEFENSE ----
['Submission Defense (General)','defense','Submission Defense','Foundation','General awareness and early defense against common submissions.',['Awareness']],
['Grip Fighting','defense','Grip Fighting','Developing','Breaking and preventing the opponent’s grips.',['Grip breaks']],
['Hand Fighting (Standing)','defense','Hand Fighting','Developing','Controlling hand position to prevent takedowns/grips while standing.',['Hand control']],
['Defensive Frames (Recap)','defense','Frames','Foundation','Recap of frame concepts applied specifically to defense.',['Frames']],
['Defensive Reactions','defense','Defensive Reactions','Foundation','Staying calm and reacting appropriately under pressure.',['Composure']],
['Guillotine Defense','defense','Submission Defense','Developing','Defending against a guillotine choke attempt.',['Posture','Hand fighting']],
['Armbar Defense','defense','Submission Defense','Developing','Defending against an armbar attempt.',['Grip','Posture']],
['Triangle Defense','defense','Submission Defense','Developing','Defending against a triangle choke attempt.',['Posture','Base']],
['Heel Hook Defense/Awareness','defense','Submission Defense','Advanced','Recognizing and defending leg-lock entanglements early.',['Leg control awareness']]
];
function bjjSeedId(category,name){ return 'seed-'+category+'-'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }
// A representative subset of prerequisite chains (by seed name), not an exhaustive
// map for all 119 techniques — enough to demonstrate the feature meaningfully for a
// beginner without overstating how rigid real BJJ progression actually is.
const BJJ_PREREQ_MAP={
  'Knee-Cut Pass':['Standing Pass Fundamentals'],
  'Toreando Pass':['Standing Pass Fundamentals'],
  'Leg Drag Pass':['Knee-Cut Pass'],
  'Smash Pass':['Over-Under Pass','Body-Lock Pass'],
  'Triangle Choke':['Closed Guard Attack Overview'],
  'Omoplata':['Closed Guard Attack Overview'],
  'De La Riva Sweeps & Entries':['De La Riva Guard'],
  'Single-Leg X Sweeps':['Single-Leg X'],
  'X-Guard Sweeps':['X-Guard','Single-Leg X Sweeps'],
  'Back-Take from Turtle':['Turtle Recovery to Guard'],
  'Sweep-to-Pass Transition':['Basic Scissor Sweep','Standing Pass Fundamentals'],
  'Kneebar':['Straight Ankle Lock'],
  'Toe Hold':['Straight Ankle Lock'],
  'Heel Hook (Concepts)':['Straight Ankle Lock','Heel Hook Defense/Awareness'],
  'D’Arce Choke':['Guillotine Choke'],
  'Anaconda Choke':['Guillotine Choke'],
  'Body Lock (Standing)':['Stance','Level Change'],
  'Single Leg Takedown':['Stance','Level Change'],
  'Double Leg Takedown':['Stance','Level Change']
};
function seedBjjTechniques(){
  const techs=BJJ_SEED_RAW.map(([name,category,position,level,description,keyConcepts])=>({
    id:bjjSeedId(category,name),
    name,category,position,level,description,
    keyConcepts:keyConcepts||[],
    prerequisites:[],
    confidence:1,lastDrilled:null,timesDrilled:0,notes:'',
    status:'Not Started',
    isCustom:false
  }));
  const byName={}; techs.forEach(t=>{byName[t.name]=t;});
  Object.entries(BJJ_PREREQ_MAP).forEach(([name,prereqNames])=>{
    const t=byName[name];
    if(t) t.prerequisites=prereqNames.map(n=>byName[n]?byName[n].id:null).filter(Boolean);
  });
  return techs;
}
const D={
profile:{name:'',city:'',weight:169,bf:23.5,targetWeight:150,targetBF:13,cal:2000,protein:150,carbs:210,fat:65,steps:8000,income:600,savings:2000,savingsGoal:5000,checkInCadenceDays:7},
checks:{},weightLog:[],meals:[],workouts:[],bjj:[],money:[],career:[],social:[],adventures:[],reviews:[],
// Only metadata lives here — the actual photo image data is kept in IndexedDB
// (see views/body.js) so a JSON export/localStorage write never has to carry
// full-resolution images. photoKey below is the id used to look up the blob there.
bodyPhotos:[],
coach:{last:'',plans:[]},
// locationMode: 'off' | 'whileUsing' | 'live' — a preference only, never a
// coordinate. See utils.js LOCATION_RUNTIME for why actual coordinates are
// never part of S at all (ephemeral, runtime-only, never persisted/synced).
settings:{usdaKey:'',locationMode:'off'},
foodFavorites:[],foodRecipes:[],
exerciseLibrary:[],
bjjTechniques:seedBjjTechniques(),
bjjFocus:[],
moneyBudgets:{},
moneyGoals:[],
careerSkills:[],
careerWeeklyTarget:{text:'',minutesGoal:0},
socialGoals:[],
socialPeople:[],
socialExperiments:[],
socialChallengeCompletions:[],
socialWeeklyTarget:{conversations:0,initiations:0,plans:0,socialMinutes:0},
socialChallenges:[
 {level:1,name:'Foundation',items:['Say hello to someone','Ask a simple question','Have a 2-minute conversation']},
 {level:2,name:'Comfort',items:['Talk to someone new','Stay after BJJ and talk','Ask someone about their interests','Continue a conversation instead of leaving right away']},
 {level:3,name:'Initiation',items:['Invite someone to get food','Invite someone to an activity','Attend an event alone','Go somewhere alone']},
 {level:4,name:'Connection',items:['Organize a small hangout','Attend a new group or activity','Introduce two people to each other','Make a recurring social plan']}
],
adventureGoals:[],
adventureIdeas:[],
adventureExperiments:[],
adventureCategories:['Explore','Outdoors','Food','Social','Events','Learning','Creative','Fitness','Travel','Solo','Other'],
adventureChallengeCompletions:[],
adventureWeeklyTarget:{experiences:0,minutes:0},
adventurePreferences:{},
adventureChallenges:[
 {level:1,name:'Get Out',items:['Take a different route','Visit somewhere nearby','Explore a new store or area','Spend time somewhere new']},
 {level:2,name:'Try Something',items:['Try a new activity','Eat somewhere new','Attend a local event','Do something you\'ve never done']},
 {level:3,name:'Solo',items:['Eat somewhere alone','Attend an event alone','Explore a new town alone','Spend several hours exploring alone']},
 {level:4,name:'Bigger Adventure',items:['Take a day trip','Visit a new city','Try an unfamiliar activity','Attend a larger event','Go on a longer solo outing']},
 {level:5,name:'Major Experience',items:['Take a weekend trip','Take on a major personal challenge','Have a significant new experience','Do substantial exploration']}
],
weeklyReviewPreferences:{},
weeklyReviewSnapshots:[],
// Mentor conversation history (v1.1). Deterministic local Q&A only — see
// views/mentor.js. Capped at 50 messages on save so it can't grow unbounded.
mentorMessages:[],
// Phase 2: past conversations "New Chat" archives here instead of deleting them —
// each entry is {id, endedAt, messages:[...]}. Capped (see migration below) so this
// can't grow unbounded either.
mentorArchivedConversations:[],
bjjCurriculum:[
 {id:'positions',name:'Positions',areas:['Standing','Guard','Closed Guard','Open Guard','Butterfly Guard','De La Riva','Reverse De La Riva','Single-Leg X','X-Guard','50/50 Guard','Half Guard','Side Control','Mount','Knee-on-Belly','North-South','Back Control','Turtle']},
 {id:'controls',name:'Controls',areas:['Base','Posture','Frames','Pressure','Connection','Underhooks','Overhooks','Crossface','Wrist Control','Two-on-One','Seatbelt','Leg Control','Mount Control','Side Control']},
 {id:'escapes',name:'Escapes',areas:['Mount Escapes','Side Control Escapes','North-South Escapes','Knee-on-Belly Escapes','Back Escapes','Turtle Escapes','Guard Recovery','Half Guard Recovery']},
 {id:'takedowns',name:'Takedowns / Standing',areas:['Stance & Movement','Level Change','Shots/Entries','Clinch/Body Lock','Trips & Throws','Takedown Defense','Guard Pull']},
 {id:'guard',name:'Guard',areas:['Guard Retention','Closed Guard','Open Guard','Half Guard','Butterfly Guard','De La Riva','Single-Leg X','X-Guard','Seated Guard','Off-Balancing','Sweeps','Guard Attacks']},
 {id:'passing',name:'Passing',areas:['Passing Fundamentals','Standing Passes','Knee-Cut','Toreando','Leg Drag','Body-Lock Pass','Over-Under','Smash Pass','Half-Guard Passing','Headquarters','Passing Closed Guard','Passing Open Guard','Passing Butterfly','Passing Leg Entanglements','Pressure Passing','Mobility Passing']},
 {id:'submissions',name:'Submissions',areas:['Chokes','Arm Attacks','Leg Attacks','Positional Submission Chains']},
 {id:'transitions',name:'Transitions',areas:['Position-to-Position','Submission Chains','Sweep-to-Pass','Escape-to-Stand','Scramble Concepts']},
 {id:'defense',name:'Defense',areas:['Submission Defense','Grip Fighting','Frames','Hand Fighting','Defensive Reactions']}
],
workoutTemplates:[
 {id:'full-a',name:'Full Body A',days:['Mon'],exercises:[
  {name:'Squat / Leg Press',sets:3,reps:'6-10',rest:150},
  {name:'Bench Press',sets:3,reps:'6-10',rest:150},
  {name:'Lat Pulldown',sets:3,reps:'8-12',rest:120},
  {name:'Romanian Deadlift',sets:2,reps:'8-12',rest:150},
  {name:'Lateral Raise',sets:3,reps:'12-20',rest:75},
  {name:'Curl',sets:2,reps:'10-15',rest:75}]},
 {id:'full-b',name:'Full Body B',days:['Wed'],exercises:[
  {name:'Romanian Deadlift',sets:3,reps:'6-10',rest:150},
  {name:'Incline DB Press',sets:3,reps:'8-12',rest:120},
  {name:'Cable Row',sets:3,reps:'8-12',rest:120},
  {name:'Split Squat',sets:2,reps:'8-12',rest:120},
  {name:'Shoulder Press',sets:2,reps:'8-12',rest:120},
  {name:'Triceps Pushdown',sets:2,reps:'10-15',rest:75}]},
 {id:'full-c',name:'Full Body C',days:['Fri'],exercises:[
  {name:'Leg Press / Squat',sets:3,reps:'8-12',rest:150},
  {name:'Press',sets:3,reps:'6-10',rest:150},
  {name:'Pulldown',sets:3,reps:'8-12',rest:120},
  {name:'Hamstring Curl',sets:3,reps:'10-15',rest:90},
  {name:'Lateral Raise',sets:3,reps:'12-20',rest:75},
  {name:'Arms',sets:2,reps:'10-15',rest:75}]},
 {id:'push',name:'Push',days:[],exercises:[]},
 {id:'pull',name:'Pull',days:[],exercises:[]},
 {id:'legs',name:'Legs',days:[],exercises:[]}
],
activeWorkout:null,
restTimer:{seconds:90,remaining:0,running:false,updatedAt:null}
};
const SCHEMA_VERSION=1;
// Centralized, additive-only defaults. Never removes or rewrites an existing field —
// only fills in what's missing, so older/partial backups and cloud states stay safe to load.
function migrateState(raw){
  let s=(raw&&typeof raw==='object')?raw:structuredClone(D);
  s.profile={...D.profile,...(s.profile||{})};
  s.settings={...D.settings,...(s.settings||{})};
  s.checks=s.checks||{};
  s.weightLog=s.weightLog||[];
  // Additive backfill only: photo metadata (never the image itself, which lives in
  // IndexedDB) keeps every original field, with new fields defaulting to null/''
  // only when missing.
  s.bodyPhotos=(s.bodyPhotos||[]).map(x=>{
    const e={...x};
    if(!('id' in e)) e.id=uid('photo');
    e.date=e.date||today();
    e.pose=e.pose||'front';
    e.weight=Number.isFinite(e.weight)?e.weight:null;
    e.bf=Number.isFinite(e.bf)?e.bf:null;
    e.notes=e.notes||'';
    if(!('photoKey' in e)) e.photoKey=e.id;
    return e;
  });
  // Additive backfill only: every original field (cal/prot/servingSize/source/etc.)
  // is preserved by spreading the record first. mealType defaults to 'Snack' for
  // legacy entries logged before meal types existed — a neutral bucket that doesn't
  // claim it was any specific meal, never touching the actual logged nutrition.
  s.meals=(s.meals||[]).map(m=>{
    const e={...m};
    e.mealType=e.mealType||'Snack';
    if(!('quantity' in e)) e.quantity=Number.isFinite(e.servings)?e.servings:1;
    if(!('unit' in e)) e.unit='serving';
    return e;
  });
  s.workouts=s.workouts||[];
  s.bjj=s.bjj||[];
  // Additive backfill only: existing transactions keep every original field
  // (date/type/amount/note/etc.) exactly as-is; a stable id is added only if missing,
  // so deletion has something safe to target even for pre-Phase-7 records.
  s.money=(s.money||[]).map(m=>('id' in m)?m:{...m,id:uid('money')});
  s.moneyBudgets=s.moneyBudgets||{};
  s.moneyGoals=s.moneyGoals||[];
  // Additive backfill only: every original field (date/name/anything else already
  // stored) is preserved by spreading the record first — new experiment fields are
  // added only when missing, so legacy 2-field records upgrade safely in place.
  s.career=(s.career||[]).map(x=>{
    const e={...x};
    if(!('id' in e)) e.id=uid('career');
    e.name=e.name||'';
    e.category=e.category||'';
    e.status=e.status||'Exploring';
    e.dateStarted=e.dateStarted||e.date||today();
    if(!('dateCompleted' in e)) e.dateCompleted=null;
    if(!('lastActivity' in e)) e.lastActivity=null;
    e.timeInvested=ensureNumber(e.timeInvested,0);
    e.whatIActuallyDid=e.whatIActuallyDid||'';
    e.whatILearned=e.whatILearned||'';
    e.whatILiked=e.whatILiked||'';
    e.whatIDisliked=e.whatIDisliked||'';
    e.difficulty=Number.isFinite(e.difficulty)?e.difficulty:null;
    e.earningPotential=Number.isFinite(e.earningPotential)?e.earningPotential:null;
    e.interest=Number.isFinite(e.interest)?e.interest:null;
    e.confidence=Number.isFinite(e.confidence)?e.confidence:null;
    e.fit=Number.isFinite(e.fit)?e.fit:null;
    e.nextStep=e.nextStep||'';
    e.notes=e.notes||'';
    e.sessions=e.sessions||[];
    e.roadmap=e.roadmap||{current:'',next:'',after:'',goal:''};
    return e;
  });
  s.careerSkills=(s.careerSkills||[]).map(x=>{
    const sk={...x};
    if(!('id' in sk)) sk.id=uid('skill');
    sk.name=sk.name||'';
    sk.category=sk.category||'';
    sk.currentLevel=Number.isFinite(sk.currentLevel)?sk.currentLevel:1;
    sk.targetLevel=Number.isFinite(sk.targetLevel)?sk.targetLevel:sk.currentLevel;
    sk.whyItMatters=sk.whyItMatters||'';
    sk.earningPotential=Number.isFinite(sk.earningPotential)?sk.earningPotential:null;
    if(!('lastPracticed' in sk)) sk.lastPracticed=null;
    sk.practiceMinutes=ensureNumber(sk.practiceMinutes,0);
    sk.notes=sk.notes||'';
    sk.practiceHistory=sk.practiceHistory||[];
    return sk;
  });
  s.careerWeeklyTarget={text:'',minutesGoal:0,...(s.careerWeeklyTarget||{})};
  // Additive backfill only: existing rep records keep every original field
  // (date/text/anything else already stored) exactly as-is — new fields are added
  // only when missing, so legacy 2-field reps upgrade safely in place.
  s.social=(s.social||[]).map(x=>{
    const e={...x};
    if(!('id' in e)) e.id=uid('social');
    e.text=e.text||'';
    e.type=e.type||'Other';
    if(!('duration' in e)) e.duration=null;
    if(!('personId' in e)) e.personId=null;
    e.context=e.context||'';
    e.difficulty=Number.isFinite(e.difficulty)?e.difficulty:null;
    e.outcome=e.outcome||'';
    e.lesson=e.lesson||'';
    return e;
  });
  s.socialGoals=(s.socialGoals||[]).map(x=>{
    const g={...x};
    if(!('id' in g)) g.id=uid('sgoal');
    g.name=g.name||'';
    g.description=g.description||'';
    g.targetFrequency=Number.isFinite(g.targetFrequency)?g.targetFrequency:null;
    if(!('active' in g)) g.active=true;
    g.createdDate=g.createdDate||today();
    return g;
  });
  s.socialPeople=(s.socialPeople||[]).map(x=>{
    const p={...x};
    if(!('id' in p)) p.id=uid('person');
    p.name=p.name||'';
    p.context=p.context||'';
    if(!('lastInteraction' in p)) p.lastInteraction=null;
    p.interactionCount=ensureNumber(p.interactionCount,0);
    p.notes=p.notes||'';
    p.relationshipType=p.relationshipType||'Other';
    return p;
  });
  s.socialExperiments=(s.socialExperiments||[]).map(x=>{
    const ex={...x};
    if(!('id' in ex)) ex.id=uid('sexp');
    ex.title=ex.title||'';
    ex.date=ex.date||today();
    ex.whatIPlanned=ex.whatIPlanned||'';
    ex.whatHappened=ex.whatHappened||'';
    ex.whatILearned=ex.whatILearned||'';
    ex.difficulty=Number.isFinite(ex.difficulty)?ex.difficulty:null;
    if(!('completed' in ex)) ex.completed=false;
    return ex;
  });
  s.socialChallengeCompletions=s.socialChallengeCompletions||[];
  s.socialChallenges=(s.socialChallenges&&s.socialChallenges.length)?s.socialChallenges:structuredClone(D.socialChallenges);
  s.socialWeeklyTarget={conversations:0,initiations:0,plans:0,socialMinutes:0,...(s.socialWeeklyTarget||{})};
  // Additive backfill only: existing entries keep every original field (date/text/
  // anything else already stored) exactly as-is. Legacy entries were always logged
  // retrospectively (the old form only recorded things already done), so completed:true
  // is an honest interpretation, not a fabrication -- new fields default to null/''
  // where the true historical value is genuinely unknown.
  s.adventures=(s.adventures||[]).map(x=>{
    const e={...x};
    if(!('id' in e)) e.id=uid('adventure');
    e.text=e.text||'';
    e.title=e.title||'';
    e.category=e.category||'';
    e.location=e.location||'';
    if(!('duration' in e)) e.duration=null;
    if(!('cost' in e)) e.cost=null;
    e.soloOrWithOthers=e.soloOrWithOthers||'';
    e.difficulty=Number.isFinite(e.difficulty)?e.difficulty:null;
    e.novelty=Number.isFinite(e.novelty)?e.novelty:null;
    if(!('completed' in e)) e.completed=true;
    e.notes=e.notes||'';
    e.whatIExperienced=e.whatIExperienced||'';
    e.whatILearned=e.whatILearned||'';
    return e;
  });
  s.adventureGoals=(s.adventureGoals||[]).map(x=>{
    const g={...x};
    if(!('id' in g)) g.id=uid('agoal');
    g.name=g.name||'';
    g.description=g.description||'';
    g.targetFrequency=Number.isFinite(g.targetFrequency)?g.targetFrequency:null;
    if(!('active' in g)) g.active=true;
    g.createdDate=g.createdDate||today();
    return g;
  });
  s.adventureIdeas=(s.adventureIdeas||[]).map(x=>{
    const i={...x};
    if(!('id' in i)) i.id=uid('aidea');
    i.title=i.title||'';
    i.category=i.category||'';
    i.estimatedCost=Number.isFinite(i.estimatedCost)?i.estimatedCost:null;
    i.estimatedDuration=Number.isFinite(i.estimatedDuration)?i.estimatedDuration:null;
    i.difficulty=Number.isFinite(i.difficulty)?i.difficulty:null;
    i.soloOrGroup=i.soloOrGroup||'';
    i.notes=i.notes||'';
    i.status=i.status||'Idea';
    return i;
  });
  s.adventureExperiments=(s.adventureExperiments||[]).map(x=>{
    const ex={...x};
    if(!('id' in ex)) ex.id=uid('aexp');
    ex.title=ex.title||'';
    ex.date=ex.date||today();
    ex.whatIPlanned=ex.whatIPlanned||'';
    ex.whatHappened=ex.whatHappened||'';
    ex.whatILearned=ex.whatILearned||'';
    ex.difficulty=Number.isFinite(ex.difficulty)?ex.difficulty:null;
    if(!('completed' in ex)) ex.completed=false;
    return ex;
  });
  s.adventureCategories=(s.adventureCategories&&s.adventureCategories.length)?s.adventureCategories:structuredClone(D.adventureCategories);
  s.adventureChallengeCompletions=s.adventureChallengeCompletions||[];
  s.adventureChallenges=(s.adventureChallenges&&s.adventureChallenges.length)?s.adventureChallenges:structuredClone(D.adventureChallenges);
  s.adventureWeeklyTarget={experiences:0,minutes:0,...(s.adventureWeeklyTarget||{})};
  s.adventurePreferences=s.adventurePreferences||{};
  s.reviews=s.reviews||[];
  s.weeklyReviewPreferences=s.weeklyReviewPreferences||{};
  s.mentorMessages=(s.mentorMessages||[]).map(m=>({role:m.role==='user'?'user':'mentor',text:m.text||'',at:m.at||today(),...(m.isError?{isError:true}:{}),...(m.recommendation?{recommendation:m.recommendation}:{})}));
  s.mentorArchivedConversations=Array.isArray(s.mentorArchivedConversations)?s.mentorArchivedConversations.slice(0,20).map(c=>({
    id:c&&c.id||uid('conv'),
    endedAt:c&&c.endedAt||today(),
    messages:Array.isArray(c&&c.messages)?c.messages.map(m=>({role:m.role==='user'?'user':'mentor',text:m.text||'',at:m.at||today()})):[]
  })):[];
  // Additive backfill only: every original field is preserved by spreading the record
  // first — new snapshot fields default to empty/false only when missing, so a
  // snapshot saved by a future version of this phase always upgrades safely in place.
  // Nothing here fabricates history: wins/friction/priorities are only ever what the
  // user actually entered, and reflection text defaults to '' (never invented).
  s.weeklyReviewSnapshots=(s.weeklyReviewSnapshots||[]).map(x=>{
    const r={...x};
    if(!('id' in r)) r.id=uid('wreview');
    r.weekStart=r.weekStart||'';
    r.weekEnd=r.weekEnd||'';
    if(!('completed' in r)) r.completed=false;
    if(!('completedAt' in r)) r.completedAt=null;
    r.reflection={wentWell:'',didnt:'',proud:'',learned:'',mostFriction:'',stopDoing:'',continueDoing:'',startDoing:'',...(r.reflection||{})};
    r.wins=(r.wins||[]).map(w=>{
      const win={...w};
      if(!('id' in win)) win.id=uid('win');
      win.text=win.text||'';
      win.category=win.category||'';
      win.date=win.date||r.weekStart||today();
      return win;
    });
    r.friction=(r.friction||[]).map(f=>{
      const fr={...f};
      if(!('id' in fr)) fr.id=uid('friction');
      fr.problem=fr.problem||'';
      fr.category=fr.category||'Other';
      fr.severity=Number.isFinite(fr.severity)?fr.severity:null;
      fr.cause=fr.cause||'';
      fr.adjustment=fr.adjustment||'';
      fr.date=fr.date||r.weekStart||today();
      return fr;
    });
    r.priorities=(r.priorities||[]).map(p=>{
      const pr={...p};
      if(!('id' in pr)) pr.id=uid('priority');
      pr.priority=pr.priority||'';
      pr.why=pr.why||'';
      pr.action=pr.action||'';
      pr.target=pr.target||'';
      pr.category=pr.category||'Personal';
      if(!('completed' in pr)) pr.completed=false;
      return pr;
    });
    return r;
  });
  s.coach=s.coach||{last:'',plans:[]};
  s.coach.plans=s.coach.plans||[];
  s.foodFavorites=s.foodFavorites||[];
  s.foodRecipes=s.foodRecipes||[];
  s.exerciseLibrary=s.exerciseLibrary||[];
  // s.bjj (sessions) is preserved exactly as-is by the s.bjj=s.bjj||[] line above —
  // it already existed and is already read by views/today.js and views/coach.js.
  // Additive backfill only: every original field (confidence/timesDrilled/notes/etc.)
  // is preserved by spreading the record first — new v1.1 fields are only added when
  // missing, so a technique the user already practiced never loses its progress.
  s.bjjTechniques=(s.bjjTechniques||[]).map(t=>{
    const e={...t};
    if(!('id' in e)) e.id=uid('tech');
    e.name=e.name||'';
    e.category=e.category||'';
    e.position=e.position||'';
    e.level=e.level||'Foundation';
    e.description=e.description||'';
    e.keyConcepts=e.keyConcepts||[];
    e.prerequisites=e.prerequisites||[];
    e.confidence=Number.isFinite(e.confidence)?e.confidence:1;
    if(!('lastDrilled' in e)) e.lastDrilled=null;
    e.timesDrilled=ensureNumber(e.timesDrilled,0);
    e.notes=e.notes||'';
    e.status=e.status||'Not Started';
    // Any technique that existed before v1.1 was necessarily user-created (the
    // pre-populated curriculum didn't exist yet) — isCustom defaults true only when
    // genuinely missing, never overriding an explicit false from the seed merge below.
    if(!('isCustom' in e)) e.isCustom=true;
    return e;
  });
  // Merge in any pre-populated technique the user doesn't already have (matched by
  // stable seed id) without ever touching an existing entry — preserves all user
  // progress across repeated migrations and works whether the account is brand new
  // or already has custom techniques logged from before this feature existed.
  const existingBjjTechIds=new Set(s.bjjTechniques.map(t=>t.id));
  const missingSeedTechs=seedBjjTechniques().filter(t=>!existingBjjTechIds.has(t.id));
  s.bjjTechniques=[...s.bjjTechniques,...missingSeedTechs];
  s.bjjFocus=s.bjjFocus||[];
  // Additive: merge in any new subcategory areas without ever removing user data —
  // there's no UI to remove/edit an area, so this only ever grows a category's list.
  s.bjjCurriculum=(s.bjjCurriculum&&s.bjjCurriculum.length)?s.bjjCurriculum.map(cat=>{
    const seedCat=D.bjjCurriculum.find(c=>c.id===cat.id);
    if(!seedCat) return cat;
    const mergedAreas=[...cat.areas];
    seedCat.areas.forEach(a=>{ if(!mergedAreas.includes(a)) mergedAreas.push(a); });
    return {...cat,areas:mergedAreas};
  }):structuredClone(D.bjjCurriculum);
  s.workoutTemplates=s.workoutTemplates||structuredClone(D.workoutTemplates);
  s.activeWorkout=s.activeWorkout||null;
  s.restTimer={...D.restTimer,...(s.restTimer||{})};
  s.schemaVersion=SCHEMA_VERSION;
  return s;
}
let S=migrateState(JSON.parse(localStorage.getItem(KEY)||'null'));
function save(){
  localStorage.setItem(KEY,JSON.stringify(S));
  scheduleSync();
}
