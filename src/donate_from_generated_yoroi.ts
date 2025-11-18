import axios from 'axios';
import { mnemonicToEntropy } from "@meshsdk/core";
// import fs from 'fs'; // Không cần fs nữa

// [GIỮ NGUYÊN] Dùng 'import CSL = require(...)'
import CSL = require('@emurgo/cardano-serialization-lib-nodejs');

// --- CẤU HÌNH ---
const destination = process.env.DESTINATION_WALLET_ADDRESS as string;
const HARDENED = 0x80000000;
const mnemonic = process.env.MNEMONIC!; 
const entropyHex = mnemonicToEntropy(mnemonic);
const entropy = Buffer.from(entropyHex, "hex");
const pwd = new Uint8Array(); 

const ADDRESS_COUNT_TO_GENERATE = 40; 
// -----------------

// --- Hàm Delay (giữ nguyên) ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// -----------------------------

/**
 * [THAY ĐỔI] Lấy 'role' từ đối số và quyết định mảng 'rolesToProcess'
 * 0 = External/Payment (Mặc định)
 * 1 = Internal/Change
 * 2 = Cả 0 và 1
 */
const roleArg = process.argv[2];
let rolesToProcess: number[];
let startMessage: string;

if (roleArg === '1') {
    rolesToProcess = [1];
    startMessage = "--- 🚀 BẮT ĐẦU SCRIPT VỚI ROLE: 1 (Internal/Change) ---";
} else if (roleArg === '2') {
    rolesToProcess = [0, 1]; // [MỚI] Chạy cả hai
    startMessage = "--- 🚀 BẮT ĐẦU SCRIPT VỚI ROLE: 0 VÀ 1 (Cả External và Internal) ---";
} else {
    rolesToProcess = [0]; // Mặc định là 0
    startMessage = "--- 🚀 BẮT ĐẦU SCRIPT VỚI ROLE: 0 (External/Payment) ---";
}
console.log(startMessage);


// [GIỮ NGUYÊN] Chuẩn bị message (chỉ 1 lần)
const message = `Assign accumulated Scavenger rights to: ${destination}`;
const messageBytes = Buffer.from(message, "utf-8"); // Chuyển message sang bytes


/**
 * [GIỮ NGUYÊN] Hàm chính
 */
async function processDonations() {
    
    // [GIỮ NGUYÊN] Vòng lặp Account
    for(let index = Number(process.env.ACCOUNT_INDEX_START); index < (Number(process.env.AMOUNT_ACCOUNT)+ Number(process.env.ACCOUNT_INDEX_START)); index ++) {
        
        console.log(`\n======================================================`);
        console.log(`Đang xử lý Account ${index}`);
        console.log(`======================================================`);

        try {
            // [GIỮ NGUYÊN] Kiểm tra CSL
            if (!CSL || !CSL.Credential) {
                console.error("❌ LỖI: Thư viện CSL không được nạp đúng cách! 'CSL.Credential' là undefined.");
                break; // Dừng vòng lặp account
            }

            const rootKey = CSL.Bip32PrivateKey.from_bip39_entropy(entropy, pwd);
            const accountKey = rootKey
                .derive(1852 | HARDENED)
                .derive(1815 | HARDENED)
                .derive(index | HARDENED); // 'index' là Account Index

            // 1. Lấy Stake Credential CỐ ĐỊNH cho account này
            const stakeKey = accountKey.derive(2).derive(0); // Role 2 = Staking
            const stakeCred = CSL.Credential.from_keyhash(stakeKey.to_public().to_raw_key().hash());
            console.log(`   🔑 Stake Key cho Account ${index} đã được xác định.`);


            // 2. [VÒNG LẶP MỚI] Lặp qua các role cần xử lý (ví dụ: [0, 1])
            for (const roleToScan of rolesToProcess) {
                
                console.log(`\n   --- Bắt đầu quét Role ${roleToScan} ( ${roleToScan === 0 ? 'External' : 'Internal'} ) ---`);

                // 3. Vòng lặp TẠO địa chỉ
                for (let addressIndex = 0; addressIndex < ADDRESS_COUNT_TO_GENERATE; addressIndex++) {
                    
                    console.log(`\n      --- Đang xử lý (Index ${addressIndex}) ---`);

                    // 4. Derive Payment Key
                    const paymentKey = accountKey.derive(roleToScan).derive(addressIndex);
                    
                    // 5. Tạo Payment Credential
                    const paymentCred = CSL.Credential.from_keyhash(paymentKey.to_public().to_raw_key().hash());

                    // 6. TẠO ĐỊA CHỈ (Ghép Payment Key và Stake Key)
                    const baseAddress = CSL.BaseAddress.new(
                        CSL.NetworkInfo.mainnet().network_id(),
                        paymentCred, // Key thanh toán thay đổi
                        stakeCred      // Key ủy quyền cố định
                    );
                    const targetAddress = baseAddress.to_address().to_bech32();
                    console.log(`      📬 Đã tạo địa chỉ: ${targetAddress}`);

                    // 7. KÝ
                    const rawPrivateKey = paymentKey.to_raw_key();
                    const cslSignature = rawPrivateKey.sign(messageBytes);
                    const signatureHex = cslSignature.to_hex();
                    
                    // 8. Gửi (Submit)
                    const donateUrl = `${process.env.BASE_URL}/donate_to/${destination}/${targetAddress}/${signatureHex}`;
                    console.log(`      ...Đang gửi tới API: ${donateUrl.substring(0, 80)}...`);


                    
                    console.log(`      ...Tạm dừng 1 giây...`);
                    await delay(1000); 
                    
                } // --- Kết thúc vòng lặp 'addressIndex' ---
            
            } // --- Kết thúc vòng lặp 'roleToScan' ---

        } catch (deriveError) {
            console.error(`   ❌ Lỗi nghiêm trọng khi derive key cho Account ${index}:`, deriveError.message);
        }

    } // --- Kết thúc vòng lặp 'index' (account) ---
    
    console.log("\n🎉🎉🎉 Đã hoàn tất xử lý tất cả địa chỉ được tạo.");
}

// Chạy hàm chính
processDonations();
