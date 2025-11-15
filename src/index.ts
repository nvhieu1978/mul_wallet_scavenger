import axios from 'axios';
import { BlockfrostProvider, MeshWallet, mnemonicToEntropy } from "@meshsdk/core";
import fs from 'fs';
import { Bip32PrivateKey } from '@emurgo/cardano-serialization-lib-nodejs';

const blockfrostProvider = new BlockfrostProvider(process.env.BLOCKFROST_API_KEY as string);
// --- THÊM HÀM DELAY ---
// Hàm này tạo ra một Promise sẽ hoàn thành sau 'ms' mili-giây
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// --------------------------
let json: any = {};

const tandc  = await axios.get(`${process.env.BASE_URL}/TandC`);
const HARDENED = 0x80000000;
const mnemonic = process.env.MNEMONIC!;
const entropyHex = mnemonicToEntropy(mnemonic);
const entropy = Buffer.from(entropyHex, "hex");
const pwd = new Uint8Array(); 


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
    const signature  = await meshWallet.signData(
        Buffer.from(tandc?.data?.message).toString("utf-8")
    );

    const rootKey = Bip32PrivateKey.from_bip39_entropy(entropy, pwd);

    const accountKey = rootKey
        .derive(1852 | HARDENED)
        .derive(1815 | HARDENED)
        .derive(index | HARDENED);

    const paymentKey = accountKey
        .derive(0)
        .derive(0);

    const pubKeyHex = Buffer
        .from(paymentKey.to_public().to_raw_key().as_bytes())
        .toString("hex");

    // console.log("Account:", index);
    // console.log("Address:", address);
    // console.log("Public Key:", pubKeyHex);
    // console.log("Signature:", signature.signature);

    const { data } = await axios.post(`${process.env.BASE_URL}/register/${address}/${signature.signature}/${pubKeyHex}`, {});
    console.log(data);

    json[address] = {
        registration_receipt: {
            preimage: data?.preimage,
            timestamp: data?.timestamp,

            registrationReceipt: {
                preimage: data?.preimage,
                timestamp: data?.timestamp,
                signature: data?.signature,
            },

            walletAddress: address,
            signature: signature.signature,   
            publicKey: pubKeyHex,
            hash: "e3123065a9b5216658fa37e9b2132624f2e2f8eb0916a219a416c7cdc1a0948e",
            version: "1-0",
            serverSignature: data?.signature
        },

        challenge_queue: []
  };
    // --- THÊM VÀO: DELAY 2 GIÂY ---
    // Thêm một log để biết nó đang tạm dừng
    console.log(`Đã xử lý tài khoản ${index}. Tạm dừng 2 giây...`);
    // Chờ 2000 mili-giây (tức là 2 giây) trước khi bắt đầu vòng lặp tiếp theo
    await delay(2000);
    // -----------------------------
}


fs.writeFileSync("./challenges.json", JSON.stringify(json, null, 4));
console.log("✅ File wallets.json đã tạo thành công!");
