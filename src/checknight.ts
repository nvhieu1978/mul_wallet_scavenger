import axios from 'axios';
import { BlockfrostProvider, MeshWallet, mnemonicToEntropy } from "@meshsdk/core";
import fs from 'fs';

const blockfrostProvider = new BlockfrostProvider(process.env.BLOCKFROST_API_KEY as string);
// --- THÊM HÀM DELAY ---
// Hàm này tạo ra một Promise sẽ hoàn thành sau 'ms' mili-giây
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// --------------------------
let json: any[] = [];
const HARDENED = 0x80000000;
const mnemonic = process.env.MNEMONIC!;
const entropyHex = mnemonicToEntropy(mnemonic);
let total: number = 0;

for(let index = Number(process.env.ACCOUNT_INDEX_START); index < (Number(process.env.AMOUNT_ACCOUNT)+ Number(process.env.ACCOUNT_INDEX_START)); index ++) {

    const meshWallet = new MeshWallet({
        networkId: 1,
        accountIndex: index,
        fetcher: blockfrostProvider,
        submitter: blockfrostProvider,
        key: {
            type: "mnemonic",
            words: mnemonic.split(" "),
        },
    });

    const address = await meshWallet.getChangeAddress();
   
    const {data} = await axios.get(`https://scavenger.prod.gd.midnighttge.io/statistics/${address}`)



   
    total += Number(data?.local?.night_allocation) / 1_000_000;
    json.push({
        account_index: index,
        address: address,
        night: Number(data?.local?.night_allocation) / 1_000_000
    });
// --- THÊM VÀO: DELAY 2 GIÂY ---
    // Thêm một log để biết nó đang tạm dừng
    console.log(`Đã xử lý tài khoản ${index}. Tạm dừng 2 giây...`);
    // Chờ 2000 mili-giây (tức là 2 giây) trước khi bắt đầu vòng lặp tiếp theo
    await delay(2000);
    // -----------------------------
}


fs.writeFileSync("./wallet.json", JSON.stringify(json, null, 4));
console.log(`✅ ${total} Night & File wallets.json đã tạo thành công !`);
