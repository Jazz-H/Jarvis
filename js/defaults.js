// defaults.js - Default data that seeds localStorage on first run (everything is editable in-app afterwards).
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- DEFAULT DATA (seeds localStorage on first run; everything below is editable in-app after) ----------

const DEFAULT_SKIN_RULES = [];
// The original three rules, removed from saved lists on load (see loadAllContent)
const RETIRED_SKIN_RULES = [
  "Vitamin C (AM) and Glycolic Acid (PM) are fine same day — just never same session.",
  "SPF is the final AM step, no exceptions, even indoors.",
  "Multi-Peptide Lash & Brow Serum is always the very last PM step."
];

const DEFAULT_SKIN_DAYS = [
  {
    day:"Monday",
    am:[
      ["Cleanse","Glucoside Foaming Cleanser"],
      ["Vitamin C","Ascorbyl Glucoside 12%"],
      ["Niacinamide","10% + Zinc"],
      ["Moisturize","Natural Moisturizing Factors + HA"],
      ["Hair mist","Daily Hair Spray"],
      ["SPF — last step","Daily Sunscreen SPF 30"]
    ],
    pm:[
      ["Cleanse","Glucoside Foaming Cleanser"],
      ["Exfoliate","Glycolic Acid 7%","Mon / Wed / Fri only"],
      ["Niacinamide","10% + Zinc"],
      ["Moisturize","Natural Moisturizing Factors + HA"],
      ["Eye area","Caffeine Solution 5% + EGCG"],
      ["Hair mist","Daily Hair Spray"],
      ["Lash/brow — last step","Multi-Peptide Lash & Brow Serum"]
    ]
  },
  {
    day:"Tuesday",
    am:[
      ["Cleanse","Glucoside Foaming Cleanser"],
      ["Vitamin C","Ascorbyl Glucoside 12%"],
      ["Niacinamide","10% + Zinc"],
      ["Moisturize","Natural Moisturizing Factors + HA"],
      ["Hair mist","Daily Hair Spray"],
      ["SPF — last step","Daily Sunscreen SPF 30"]
    ],
    pm:[
      ["Cleanse","Glucoside Foaming Cleanser"],
      ["Niacinamide","10% + Zinc"],
      ["Moisturize","Natural Moisturizing Factors + HA"],
      ["Eye area","Caffeine Solution 5% + EGCG"],
      ["Hair mist","Daily Hair Spray"],
      ["Lash/brow — last step","Multi-Peptide Lash & Brow Serum"]
    ]
  },
  {
    day:"Wednesday",
    am:[
      ["Cleanse","Glucoside Foaming Cleanser"],
      ["Vitamin C","Ascorbyl Glucoside 12%"],
      ["Niacinamide","10% + Zinc"],
      ["Moisturize","Natural Moisturizing Factors + HA"],
      ["Hair mist","Daily Hair Spray"],
      ["SPF — last step","Daily Sunscreen SPF 30"]
    ],
    pm:[
      ["Cleanse","Glucoside Foaming Cleanser"],
      ["Exfoliate","Glycolic Acid 7%","Mon / Wed / Fri only"],
      ["Niacinamide","10% + Zinc"],
      ["Moisturize","Natural Moisturizing Factors + HA"],
      ["Eye area","Caffeine Solution 5% + EGCG"],
      ["Hair mist","Daily Hair Spray"],
      ["Lash/brow — last step","Multi-Peptide Lash & Brow Serum"]
    ]
  },
  {
    day:"Thursday",
    am:[
      ["Cleanse","Glucoside Foaming Cleanser"],
      ["Vitamin C","Ascorbyl Glucoside 12%"],
      ["Niacinamide","10% + Zinc"],
      ["Moisturize","Natural Moisturizing Factors + HA"],
      ["Hair mist","Daily Hair Spray"],
      ["SPF — last step","Daily Sunscreen SPF 30"]
    ],
    pmWash:[
      ["Wash day","Clarifying Shampoo"],
      ["Mask","Strengthening Hair Mask"],
      ["Cleanse","Glucoside Foaming Cleanser"],
      ["Niacinamide","10% + Zinc"],
      ["Moisturize","Natural Moisturizing Factors + HA"],
      ["Lash/brow — last step","Multi-Peptide Lash & Brow Serum"]
    ],
    pm:[
      ["Cleanse","Glucoside Foaming Cleanser"],
      ["Niacinamide","10% + Zinc"],
      ["Moisturize","Natural Moisturizing Factors + HA"],
      ["Eye area","Caffeine Solution 5% + EGCG"],
      ["Hair mist","Daily Hair Spray"],
      ["Lash/brow — last step","Multi-Peptide Lash & Brow Serum"]
    ]
  },
  {
    day:"Friday",
    am:[
      ["Cleanse","Glucoside Foaming Cleanser"],
      ["Vitamin C","Ascorbyl Glucoside 12%"],
      ["Niacinamide","10% + Zinc"],
      ["Moisturize","Natural Moisturizing Factors + HA"],
      ["Hair mist","Daily Hair Spray"],
      ["SPF — last step","Daily Sunscreen SPF 30"]
    ],
    pm:[
      ["Cleanse","Glucoside Foaming Cleanser"],
      ["Exfoliate","Glycolic Acid 7%","Mon / Wed / Fri only"],
      ["Niacinamide","10% + Zinc"],
      ["Moisturize","Natural Moisturizing Factors + HA"],
      ["Eye area","Caffeine Solution 5% + EGCG"],
      ["Hair mist","Daily Hair Spray"],
      ["Lash/brow — last step","Multi-Peptide Lash & Brow Serum"]
    ]
  },
  {
    day:"Saturday",
    am:[
      ["Cleanse","Glucoside Foaming Cleanser"],
      ["Vitamin C","Ascorbyl Glucoside 12%"],
      ["Niacinamide","10% + Zinc"],
      ["Moisturize","Natural Moisturizing Factors + HA"],
      ["Hair mist","Daily Hair Spray"],
      ["SPF — last step","Daily Sunscreen SPF 30"]
    ],
    pm:[
      ["Cleanse","Glucoside Foaming Cleanser"],
      ["Niacinamide","10% + Zinc"],
      ["Moisturize","Natural Moisturizing Factors + HA"],
      ["Eye area","Caffeine Solution 5% + EGCG"],
      ["Hair mist","Daily Hair Spray"],
      ["Lash/brow — last step","Multi-Peptide Lash & Brow Serum"]
    ]
  },
  {
    day:"Sunday",
    am:[
      ["Cleanse","Glucoside Foaming Cleanser"],
      ["Vitamin C","Ascorbyl Glucoside 12%"],
      ["Niacinamide","10% + Zinc"],
      ["Moisturize","Natural Moisturizing Factors + HA"],
      ["Hair mist","Daily Hair Spray"],
      ["SPF — last step","Daily Sunscreen SPF 30"]
    ],
    pm:[
      ["Cleanse","Glucoside Foaming Cleanser"],
      ["Niacinamide","10% + Zinc"],
      ["Moisturize","Natural Moisturizing Factors + HA"],
      ["Eye area","Caffeine Solution 5% + EGCG"],
      ["Hair mist","Daily Hair Spray"],
      ["Lash/brow — last step","Multi-Peptide Lash & Brow Serum"]
    ]
  }
];

const DEFAULT_STYLE_RULES = [
  "Front-tuck shirts for a cleaner line.",
  "Hem chinos and dress pants to fit.",
  "Size bottoms for comfort.",
  "Avoid oversized or drop-shoulder cuts.",
  "Ankle-length dress pants = business casual only, worn with no-show socks and loafers — never sneakers.",
  "White sneakers or tan/brown loafers pair better than black shoes with muted or sage green."
];

const DEFAULT_SIZES = [
  ["Tops","M"],["Outerwear","M"],
  ["Bottoms","M"],["Denim","M"],
  ["Shoes","8"],["Ring","8*"]
];

const CAP_CATS = ["Tops","Bottoms","Shoes","Outerwear","Accessories"];

const DEFAULT_CAPSULE = [
  {id:"tee-hgrey", title:"Crew tee — heather grey", state:"owned", cat:"Tops"},
  {id:"tee-plum", title:"Crew tee — plum", state:"owned", cat:"Tops"},
  {id:"tee-black", title:"Crew tee — black", state:"owned", cat:"Tops"},
  {id:"polo-graphic", title:"Graphic polo", state:"owned", cat:"Tops"},
  {id:"jeans-dark", title:"Dark-wash slim jeans", sub:"M", state:"owned", cat:"Bottoms"},
  {id:"shorts-khaki", title:"Khaki shorts", state:"owned", cat:"Bottoms"},
  {id:"shorts-bermuda", title:"Bermuda shorts", state:"owned", cat:"Bottoms"},
  {id:"tank-white", title:"Basic tank — white", state:"owned", cat:"Tops"},
  {id:"tank-black", title:"Basic tank — black", state:"owned", cat:"Tops"},
  {id:"tank-stripe", title:"Basic tank — stripe", state:"owned", cat:"Tops"},
  {id:"top-capsleeve", title:"Collared cap-sleeve top", state:"owned", cat:"Tops"},
  {id:"pants-khaki", title:"Slim pants — khaki", sub:"Size M", state:"pending", cat:"Bottoms"},
  {id:"pants-black", title:"Slim pants — black", sub:"Size M", state:"pending", cat:"Bottoms"},
  {id:"button-white", title:"Classic Button-Down — white", sub:"Size M", state:"owned", cat:"Tops"},
  {id:"chambray", title:"Chambray denim shirt", state:"owned", cat:"Tops"},
  {id:"shoe-vans-loafer", title:"Black slip-on loafers", state:"owned", cat:"Shoes"},
  {id:"shoe-dressloafer", title:"Dress-up loafers", state:"owned", cat:"Shoes"},
  {id:"shoe-timbs", title:"Work boots — black/tan", state:"owned", cat:"Shoes"},
  {id:"shoe-chelsea", title:"Black Chelsea boots", state:"owned", cat:"Shoes"},
  {id:"shoe-vans", title:"Black sneakers", state:"owned", cat:"Shoes"},
  {id:"shoe-nike", title:"Low-top sneakers — black/white", state:"owned", cat:"Shoes"},
  {id:"shoe-airmax", title:"Running sneakers — black/white", state:"owned", cat:"Shoes"},
  {id:"shoe-adidas", title:"Sneakers — white", state:"owned", cat:"Shoes"},
  {id:"acc-chain", title:"Chain necklace", state:"owned", cat:"Accessories"},
  {id:"acc-watch", title:"Smartwatch", state:"owned", cat:"Accessories"},
  {id:"acc-bag", title:"Black crossbody bag", state:"owned", cat:"Accessories"},
  {id:"acc-belt", title:"Black belt", state:"owned", cat:"Accessories"},
  {id:"need-oxford", title:"Light blue oxford", sub:"Size M", state:"needed", cat:"Tops"},
  {id:"need-blazer", title:"Structured blazer", sub:"Sample Store", state:"needed", cat:"Outerwear"},
  {id:"need-belt-brown", title:"Brown/cognac belt", price:20, estimated:true, state:"needed", cat:"Accessories"},
  {id:"need-coach", title:"Coach jacket — black", sub:"Olive secondary", state:"needed", cat:"Outerwear"},
  {id:"need-chinos", title:"Charcoal slim chinos", sub:"Sample Store", state:"needed", cat:"Bottoms"},
  {id:"need-chino-shorts", title:"Slim chino shorts — navy/olive/charcoal/white", sub:"Nice to have", state:"needed", cat:"Bottoms"}
];

const DEFAULT_WANTS = [
  {id:"pouch", name:"Trailco Paddle Pouch", meta:"Size medium", price:19.45,
   link:"https://example.com/pouch"},
  {id: "cooker", name:"Sample Cooker", meta:"", price:49.45,
   link:"https://example.com/cooker"},
  {id: "jacket", name:"Sample Rain Jacket", meta:"Gray, size S · Sample Store", price:130.00,
   link:"https://example.com/jacket"},
  {id: "boot", name:"Sample Lace-Up Boot", meta:"Black, size 8 · Sample Store", price:119.45,
   link:"https://example.com/boot"},
  {id: "band", name:"Sample Fitness Band", meta:"Size M", price:399.45,
   link:"https://www.amazon.com/Sample Band-Ring-Smallest-Activity-Compatible/dp/B0GRJZX1D8"},
  {id:"belt-brown", name:"Brown leather belt, square buckle", meta:"Pending: merge with wardrobe belt? Price/link not locked in", price:20.00,
   link:"https://us.amazon.com/Leather-1-Pack-Classic-Square-Buckle/dp/B0GV2BGNC3", estimated:true}
];

const DEFAULT_TODO = [];

let skinRules, skinRoutine, routineChecks, styleRules, sizes, capsule, wantsList, todoList;

