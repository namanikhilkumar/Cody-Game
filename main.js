// Pocket RoK (Web) — Phaser.js MVP
// Single-scene simplified RTS loop with resource production, upgrades, training, fog, and simple combat.
const W = 896, H = 640;
const TILE = 32;
const MAP_W = 20, MAP_H = 15; // 640x480 world area
const SAVE_KEY = "pocketrok-save-v1";

// --------- Game State ----------
const state = {
  resources: { food: 200, wood: 200, stone: 100, gold: 50 },
  rates:    { food: 40,  wood: 40,  stone: 20,  gold: 10 }, // per hour
  buildings: {
    cityhall: 1, farm: 1, lumber: 1, quarry: 1, gold: 1, barracks: 1
  },
  army: { inf: 0, arch: 0, cav: 0 },
  map: { revealed: [], camps: [], select: null, scoutPos: {x:2,y:2} }
};

// Costs & scaling
const upgradeBaseCost = (b, lvl) => {
  const mul = 1 + (lvl-1)*0.35;
  switch(b){
    case "cityhall": return {food:200*mul, wood:200*mul, stone:150*mul, gold:80*mul};
    case "farm":     return {food:120*mul, wood: 80*mul, stone:40*mul,  gold: 0};
    case "lumber":   return {food: 80*mul, wood:120*mul, stone:40*mul,  gold: 0};
    case "quarry":   return {food:100*mul, wood:100*mul, stone:80*mul,  gold: 0};
    case "gold":     return {food:120*mul, wood:120*mul, stone:60*mul,  gold:40*mul};
    case "barracks": return {food:140*mul, wood:140*mul, stone:80*mul,  gold:20*mul};
  }
  return {food:0,wood:0,stone:0,gold:0};
};

const trainCost = {
  inf:  {food: 30, wood:10, stone: 0, gold:0},
  arch: {food: 10, wood:30, stone: 0, gold:0},
  cav:  {food: 25, wood:15, stone: 0, gold:0}
};

// Production per hour contributed by each building level
function recalcRates(){
  const {farm, lumber, quarry, gold} = state.buildings;
  state.rates.food  = farm   * 40;
  state.rates.wood  = lumber * 40;
  state.rates.stone = quarry * 30;
  state.rates.gold  = gold   * 15;
}

// --------- Save/Load ----------
function save(){
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}
function load(){
  const s = localStorage.getItem(SAVE_KEY);
  if (!s) return;
  const obj = JSON.parse(s);
  // Protect against missing keys if we change schema
  Object.assign(state.resources, obj.resources || {});
  Object.assign(state.rates,     obj.rates || {});
  Object.assign(state.buildings, obj.buildings || {});
  Object.assign(state.army,      obj.army || {});
  state.map = obj.map || state.map;
}

// --------- UI Helpers ----------
function fmt(n){ return Math.floor(n).toLocaleString(); }
function canAfford(cost){
  return state.resources.food>=cost.food && state.resources.wood>=cost.wood && state.resources.stone>=cost.stone && state.resources.gold>=cost.gold;
}
function spend(cost){
  state.resources.food  -= Math.floor(cost.food);
  state.resources.wood  -= Math.floor(cost.wood);
  state.resources.stone -= Math.floor(cost.stone);
  state.resources.gold  -= Math.floor(cost.gold);
}

// --------- Phaser Scene ----------
class MainScene extends Phaser.Scene{
  constructor(){ super("main"); }
  preload(){}
  create(){
    // World background
    this.add.rectangle( (W-320)/2 + 160, H/2, W-320, H, 0x0a0f24 ).setOrigin(0.5);

    // Build tile grid & fog
    this.tiles = [];
    state.map.revealed = Array.from({length: MAP_H}, () => Array(MAP_W).fill(false));
    // Seed some camps
    state.map.camps = [];
    for(let i=0;i<8;i++){
      const x = Phaser.Math.Between(4, MAP_W-2);
      const y = Phaser.Math.Between(2, MAP_H-2);
      state.map.camps.push({x,y,str: Phaser.Math.Between(12,40)});
    }

    const offsetX = 340, offsetY = 16;
    for(let y=0;y<MAP_H;y++){
      for(let x=0;x<MAP_W;x++){
        const gx = offsetX + x*TILE;
        const gy = offsetY + y*TILE;
        const tile = this.add.rectangle(gx, gy, TILE-2, TILE-2, 0x173058).setOrigin(0);
        tile.setInteractive();
        tile.on("pointerdown", ()=> this.onTileClick(x,y));
        this.tiles.push(tile);
      }
    }
    // Fog graphics
    this.fog = this.add.graphics();

    // Scout starting reveal
    this.reveal(state.map.scoutPos.x, state.map.scoutPos.y, 2);

    // Camps layer
    this.campGraphics = this.add.graphics();

    // Resource tick each second
    recalcRates();
    this.time.addEvent({ delay:1000, loop:true, callback: ()=>{
      const hr = 1/3600;
      state.resources.food  += state.rates.food  * hr;
      state.resources.wood  += state.rates.wood  * hr;
      state.resources.stone += state.rates.stone * hr;
      state.resources.gold  += state.rates.gold  * hr;
      updateUI();
    }});

    // Draw loop
    this.events.on("update", ()=>{
      this.drawFog();
      this.drawCamps();
    });

    // Hook UI buttons
    document.getElementById("saveBtn").onclick = ()=>{ save(); log("Saved!"); };
    document.getElementById("resetBtn").onclick = ()=>{ localStorage.removeItem(SAVE_KEY); location.reload(); };
    document.getElementById("scoutBtn").onclick = ()=> this.scout();
    document.getElementById("attackBtn").onclick = ()=> this.attackSelected();

    // Building upgrades
    const BU = [
      ["farm","b-farm-lvl","up-farm"],
      ["lumber","b-lumber-lvl","up-lumber"],
      ["quarry","b-quarry-lvl","up-quarry"],
      ["gold","b-gold-lvl","up-gold"],
      ["barracks","b-barracks-lvl","up-barracks"],
    ];
    BU.forEach(([key,labelId,btnId])=>{
      document.getElementById(btnId).onclick = ()=> this.upgrade(key, labelId);
    });
    document.getElementById("up-cityhall").onclick = ()=> this.upgrade("cityhall","ch-level");

    // Training
    document.getElementById("t-inf").onclick  = ()=> this.train("inf", 10);
    document.getElementById("t-arch").onclick = ()=> this.train("arch",10);
    document.getElementById("t-cav").onclick  = ()=> this.train("cav", 10);

    // Load saved state if any
    load();
    recalcRates();
    updateUI();
  }

  onTileClick(x,y){
    if (!state.map.revealed[y][x]) return;
    // Select a camp if present
    const camp = state.map.camps.find(c=> c.x===x && c.y===y);
    state.map.select = camp ? {type:"camp", x,y, str: camp.str} : {type:"tile", x,y};
    document.getElementById("attackBtn").disabled = !(camp);
  }

  drawCamps(){
    const offX = 340, offY = 16;
    this.campGraphics.clear();
    for(const c of state.map.camps){
      if (state.map.revealed[c.y][c.x]){
        const gx = offX + c.x*TILE, gy = offY + c.y*TILE;
        this.campGraphics.fillStyle(0x8b2b2b, 1);
        this.campGraphics.fillRect(gx+6, gy+6, TILE-12, TILE-12);
      }
    }
  }

  drawFog(){
    const offX = 340, offY = 16;
    this.fog.clear();
    for(let y=0;y<MAP_H;y++){
      for(let x=0;x<MAP_W;x++){
        if (!state.map.revealed[y][x]){
          this.fog.fillStyle(0x0b0e1b, 0.92);
          this.fog.fillRect(offX + x*TILE, offY + y*TILE, TILE-2, TILE-2);
        }
      }
    }
    // draw scout
    const s = state.map.scoutPos;
    this.fog.fillStyle(0x3ddc84, 1);
    this.fog.fillRect(offX + s.x*TILE+8, offY + s.y*TILE+8, TILE-16, TILE-16);
  }

  reveal(x,y,r){
    for(let j=-r;j<=r;j++){
      for(let i=-r;i<=r;i++){
        const nx=x+i, ny=y+j;
        if (nx>=0 && ny>=0 && nx<MAP_W && ny<MAP_H){
          state.map.revealed[ny][nx] = true;
        }
      }
    }
  }

  scout(){
    // Move scout to a nearby unrevealed area
    let best = null, bestScore = -1;
    for(let y=0;y<MAP_H;y++){
      for(let x=0;x<MAP_W;x++){
        if (!state.map.revealed[y][x]){
          const dx = x - state.map.scoutPos.x;
          const dy = y - state.map.scoutPos.y;
          const dist = Math.hypot(dx,dy);
          const score = -dist;
          if (score > bestScore){ bestScore = score; best = {x,y}; }
        }
      }
    }
    if (!best){ log("World fully revealed!"); return; }
    // Spend a small gold fee to scout
    const fee = {food:0,wood:0,stone:0,gold:5};
    if (!canAfford(fee)){ log("Need 5 gold to send scout."); return; }
    spend(fee);
    // Move towards best by 3 tiles and reveal
    const s = state.map.scoutPos;
    const dirX = Math.sign(best.x - s.x), dirY = Math.sign(best.y - s.y);
    s.x = Phaser.Math.Clamp(s.x + dirX*3, 0, MAP_W-1);
    s.y = Phaser.Math.Clamp(s.y + dirY*3, 0, MAP_H-1);
    this.reveal(s.x, s.y, 2);
    updateUI();
  }

  upgrade(key, labelId){
    const nextLvl = state.buildings[key] + 1;
    // Gate by City Hall for other buildings
    if (key!=="cityhall" && nextLvl > state.buildings.cityhall){
      log(`Upgrade gated by City Hall. Raise CH to ${nextLvl} first.`);
      return;
    }
    const cost = upgradeBaseCost(key, nextLvl);
    if (!canAfford(cost)){ log("Not enough resources."); return; }
    spend(cost);
    state.buildings[key] = nextLvl;
    recalcRates();
    updateUI();
    log(`Upgraded ${key} to L${nextLvl}.`);
  }

  train(type, count){
    // minimal barracks gate
    if (state.buildings.barracks < 1){ log("Build Barracks first."); return; }
    const c = { food: trainCost[type].food*count, wood: trainCost[type].wood*count, stone: 0, gold: 0 };
    if (!canAfford(c)){ log("Not enough resources to train."); return; }
    spend(c);
    state.army[type] += count;
    updateUI();
    log(`Trained ${count} ${type.toUpperCase()}.`);
  }

  attackSelected(){
    const sel = state.map.select;
    if (!sel || sel.type !== "camp"){ return; }
    // compute our power
    const our = state.army.inf*1.0 + state.army.arch*1.1 + state.army.cav*1.2;
    const their = sel.str;
    const ratio = (our+1)/(their+1);
    const victory = ratio >= 0.9;
    //_losses
    const ourLoss = Math.min(state.army.inf+state.army.arch+state.army.cav, Math.ceil(their * (1/Math.max(ratio,0.1)) * 0.15));
    const theirLoss = Math.ceil((state.army.inf+state.army.arch+state.army.cav) * Math.max(ratio,0.1) * 0.35);

    // distribute ourLoss across stacks
    let remaining = ourLoss;
    const order = ["inf","arch","cav"];
    for(const k of order){
      const take = Math.min(state.army[k], remaining);
      state.army[k] -= take; remaining -= take;
    }
    // reduce camp
    sel.str = Math.max(0, sel.str - theirLoss);
    if (sel.str <= 0){
      // remove camp and reward
      state.map.camps = state.map.camps.filter(c => !(c.x===sel.x && c.y===sel.y));
      const loot = { food: 120, wood: 120, stone: 80, gold: 20 };
      state.resources.food += loot.food;
      state.resources.wood += loot.wood;
      state.resources.stone += loot.stone;
      state.resources.gold += loot.gold;
      log(`Victory! Loot: +${loot.food}F +${loot.wood}W +${loot.stone}S +${loot.gold}G`);
      state.map.select = null;
      document.getElementById("attackBtn").disabled = true;
    }else{
      log(`Battle ended. Our loss: ${ourLoss}, Camp remains: ${sel.str}`);
    }
    updateUI();
  }
}

const config = {
  type: Phaser.AUTO,
  parent: "phaser",
  width: W - 320,
  height: H,
  backgroundColor: "#0a0f24",
  scene: [MainScene]
};

const game = new Phaser.Game(config);

// --------- DOM UI binding ----------
function updateUI(){
  const r = state.resources, rate = state.rates;
  document.getElementById("r-food").textContent  = fmt(r.food);
  document.getElementById("r-wood").textContent  = fmt(r.wood);
  document.getElementById("r-stone").textContent = fmt(r.stone);
  document.getElementById("r-gold").textContent  = fmt(r.gold);
  document.getElementById("r-rate").textContent  = `${fmt(rate.food)}/${fmt(rate.wood)}/${fmt(rate.stone)}/${fmt(rate.gold)}`;
  document.getElementById("b-farm-lvl").textContent = state.buildings.farm;
  document.getElementById("b-lumber-lvl").textContent = state.buildings.lumber;
  document.getElementById("b-quarry-lvl").textContent = state.buildings.quarry;
  document.getElementById("b-gold-lvl").textContent = state.buildings.gold;
  document.getElementById("b-barracks-lvl").textContent = state.buildings.barracks;
  document.getElementById("ch-level").textContent = state.buildings.cityhall;

  const nextFarm = state.buildings.farm + 1;
  const c = upgradeBaseCost("farm", nextFarm);
  document.getElementById("cost-text").textContent = `Example upgrade (Farm→L${nextFarm}) cost: F${fmt(c.food)} W${fmt(c.wood)} S${fmt(c.stone)} G${fmt(c.gold)}`;

  const tc = trainCost;
  document.getElementById("train-cost").textContent = `Train 10: INF F${10*tc.inf.food}/W${10*tc.inf.wood}, ARCH F${10*tc.arch.food}/W${10*tc.arch.wood}, CAV F${10*tc.cav.food}/W${10*tc.cav.wood}`;

  document.getElementById("a-inf").textContent = fmt(state.army.inf);
  document.getElementById("a-arch").textContent = fmt(state.army.arch);
  document.getElementById("a-cav").textContent = fmt(state.army.cav);
}

function log(msg){
  const el = document.getElementById("battle-log");
  el.textContent = msg;
}

// Initial UI
updateUI();
