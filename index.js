// external globals:
// gasPriceCache (KV namespace)
// TG_API_KEY (env)
// TANK_API_KEY (env)

addEventListener("fetch", (event) => {
  event.respondWith(
    handleRequest(event.request).catch(
      (err) => {
        console.log("ERROR", err);
        return new Response(err.stack, { status: 500 });
      }
    )
  );
});

const TANK_API_PREFIX = "https://creativecommons.tankerkoenig.de/json/";
const TG_API_PREFIX = "https://api.telegram.org/bot";

const obj2query = o => Object.entries(o).map(([k,o])=>`${k}=${encodeURIComponent(`${o}`)}`).join("&");

const tg = async (method, params) => (await fetch(`${TG_API_PREFIX}${TG_API_KEY}/${method}?${params && obj2query(params)}`)).json();
const tank = async (method, params) => (await fetch(`${TANK_API_PREFIX}${method}.php?${obj2query({...params, apikey:TANK_API_KEY})}`)).json();

const getStationData = async (query) => {
  const ckey = obj2query(query);
  const cached = await gasPriceCache.get(ckey);
  if (cached) {
    console.log("returning cached data");
    return JSON.parse(cached);
  }
  const stationData = await tank("list", query);
  const stationIds=stationData.stations.map(s=>s.id).join(",");
  const fuelData = await tank("prices", {ids:stationIds});
  stationData.stations = stationData.stations.map(s=>{
    s.fuelPrices = fuelData.prices[s.id];
    return s;
  });
  await gasPriceCache.put(
    ckey, 
    JSON.stringify(stationData), 
    {expirationTtl: 2*60}
  );
  return stationData;
};

async function handleRequest(request) {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/fuel")) {
    const stationData = await getStationData({
      lat:48.4, lng:10.0, rad:4, sort:"price",type:"e10"
    });
    return new Response(JSON.stringify(stationData,null,2));
  }
  else if (url.pathname.startsWith("/wh-tg")) {
    const upd = await request.json();
    console.log("tg api sent:", upd);
    // TODO check upd.message.text
    let msg = "Send me your location to get fuel prices near you";
    if (upd.message.location) {
      const stationData = await getStationData({
        lat: upd.message.location.latitude.toFixed(3),
        lng: upd.message.location.longitude.toFixed(3),
        rad: 4,
        sort:"price",
        type:"e10",
      });
      msg=stationData.stations
        .filter(s=>s.fuelPrices && s.fuelPrices.status === "open")
        .map(s=>`<b>${s.brand} ${s.street} ${s.houseNumber}</b>:\n  E10 €${s.fuelPrices.e10}`)
        .slice(0,5)
        .join("\n");
    }
    const sendResult = await tg("sendMessage", {
      chat_id: upd.message.from.id, 
      parse_mode:"HTML", 
      text:msg,
    });
    console.log(sendResult);
    return new Response("ok");
  }
  else if (url.pathname.startsWith("/tg-setup")) {
    console.log("setting up Telegram");
    const bot = await tg("getMe");
    const whUrl = new URL(url);
    whUrl.pathname = "wh-tg/v2";
    const whSetResult = await tg("setWebhook", {url: whUrl});
    return new Response(`Setup complete: ${bot.result.username} ${whSetResult.description}`);
  }
  else if (url.pathname.startsWith("/tg-test")) {
    const stationData = await getStationData({
      lat:48.4, lng:10.0, rad:4, sort:"price",type:"e10"
    });
    const msg=stationData.stations
      .filter(s=>s.fuelPrices && s.fuelPrices.status === "open")
      .map(s=>`<b>${s.brand} ${s.street} ${s.houseNumber}</b>:\n  E10 €${s.fuelPrices.e10}`)
      .slice(0,5)
      .join("\n");
    const sendResult = await tg("sendMessage", 
      {chat_id: 122860086, parse_mode:"HTML", text:msg});
    console.log(sendResult);
    return new Response("ok");
  }

  return new Response("go away! 🦜");
}
