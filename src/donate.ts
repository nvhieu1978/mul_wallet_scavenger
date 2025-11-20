import axios from 'axios';
import { BlockfrostProvider, MeshWallet, mnemonicToEntropy } from "@meshsdk/core";
import { Bip32PrivateKey } from '@emurgo/cardano-serialization-lib-nodejs';
import fs from 'fs';

// --- CẤU HÌNH & KIỂM TRA ---
const ENV = {
    API_KEY: process.env.BLOCKFROST_API_KEY,
    DESTINATION: process.env.DESTINATION_WALLET_ADDRESS,
    MNEMONIC: process.env.MNEMONIC,
    BASE_URL: process.env.BASE_URL,
    START_INDEX: Number(process.env.ACCOUNT_INDEX_START || 0),
    AMOUNT: Number(process.env.AMOUNT_ACCOUNT || 0)
};

// Kiểm tra biến môi trường
const missingVars = Object.entries(ENV).filter(([_, v]) => !v && v !== 0).map(([k]) => k);
if (missingVars.length > 0) {
    console.error(`❌ LỖI: Thiếu biến môi trường: ${missingVars.join(', ')}`);
    process.exit(1);
}

// Config khác
const HARDENED = 0x80000000;
const DELAY_MS = 1000; // Delay giữa các lần chạy (1 giây)
const OUTPUT_FILE = `./wallet_${ENV.AMOUNT}.json`; // Tên file động

// Khởi tạo Provider & Key
const blockfrostProvider = new BlockfrostProvider(ENV.API_KEY as string);
const entropy = Buffer.from(mnemonicToEntropy(ENV.MNEMONIC!), "hex");
const rootKey = Bip32PrivateKey.from_bip39_entropy(entropy, new Uint8Array());

// Biến lưu kết quả
let results: any[] = [];
let totalNight = 0;

// --- HÀM TIỆN ÍCH ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function saveToFile() {
    // Thêm tổng kết vào cuối mảng trước khi lưu (hoặc cập nhật object tổng)
    const outputData = {
        summary: {
            total_accounts_scanned: results.length,
            total_night_collected: totalNight,
            destination_wallet: ENV.DESTINATION
        },
        details: results
    };
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(outputData, null, 4));
    console.log(`💾 Đã lưu dữ liệu vào ${OUTPUT_FILE}`);
}

// --- HÀM CHÍNH ---
async function main() {
    console.log(`🚀 Bắt đầu quét từ Account ${ENV.START_INDEX} đến ${ENV.START_INDEX + ENV.AMOUNT - 1}`);
    console.log(`📄 Kết quả sẽ được lưu vào: ${OUTPUT_FILE}\n`);

    for (let i = 0; i < ENV.AMOUNT; i++) {
        const index = ENV.START_INDEX + i;
        console.log(`--- 🔄 Đang xử lý Account ${index} ---`);

        try {
            // 1. Khởi tạo Wallet & Lấy địa chỉ
            const meshWallet = new MeshWallet({
                networkId: 1,
                accountIndex: index,
                fetcher: blockfrostProvider,
                submitter: blockfrostProvider,
                key: { type: "mnemonic", words: ENV.MNEMONIC!.split(" ") },
            });

            const address = await meshWallet.getChangeAddress();
            console.log(`   📍 Address: ${address}`);

            // 2. Ký Message
            const message = `Assign accumulated Scavenger rights to: ${ENV.DESTINATION}`;
            const signature = await meshWallet.signData(Buffer.from(message, "utf8").toString("hex"));

            // 3. Lấy PublicKey (Dùng CSL để derive lại cho chắc chắn)
            const accountKey = rootKey
                .derive(1852 | HARDENED)
                .derive(1815 | HARDENED)
                .derive(index | HARDENED);
            const paymentKey = accountKey.derive(0).derive(0);
            const pubKeyHex = Buffer.from(paymentKey.to_public().to_raw_key().as_bytes()).toString("hex");
            // console.log(`   🔑 PubKey: ${pubKeyHex}`);

            // 4. Lấy số dư NIGHT (Thống kê)
            let currentNight = 0;
            try {
                const { data: statData } = await axios.get(`https://scavenger.prod.gd.midnighttge.io/statistics/${address}`);
                currentNight = Number(statData?.local?.night_allocation || 0) / 1_000_000;
                console.log(`   🌙 Night Allocation: ${currentNight}`);
            } catch (err) {
                console.warn(`   ⚠️ Không lấy được thống kê Night: ${err.message}`);
            }

            // 5. Gửi Request Donate
            const postUrl = `${ENV.BASE_URL}/donate_to/${ENV.DESTINATION}/${address}/${signature.signature}`;
            try {
                await axios.post(postUrl, {}, { headers: { 'Content-Type': 'application/json' } });
                console.log(`   ✅ POST thành công!`);
            } catch (postErr: any) {
                 if (axios.isAxiosError(postErr)) {
                    // Bỏ qua lỗi 404 (chưa có reward) để không làm rác log
                    if (postErr.response?.status === 404) {
                        console.log(`   ⚪ (Chưa có reward để donate)`);
                    } else {
                        console.error(`   ❌ Lỗi POST: ${postErr.response?.status} - ${JSON.stringify(postErr.response?.data)}`);
                    }
                } else {
                    console.error(`   ❌ Lỗi kết nối: ${postErr.message}`);
                }
            }

            // 6. Lưu kết quả vào mảng
            results.push({
                account_index: index,
                address: address,
                night: currentNight,
                status: "processed"
            });
            totalNight += currentNight;

            // Lưu file ngay lập tức (để tránh mất data nếu crash giữa chừng)
            saveToFile();

        } catch (error: any) {
            console.error(`   🔥 LỖI NGHIÊM TRỌNG tại Account ${index}: ${error.message}`);
            results.push({
                account_index: index,
                error: error.message,
                status: "failed"
            });
            saveToFile(); // Vẫn lưu lỗi
        }

        await delay(DELAY_MS);
    }

    console.log(`\n✨ HOÀN TẤT! Tổng NIGHT thu được: ${totalNight}`);
    saveToFile(); // Lưu lần cuối
}

main().catch(console.error);
