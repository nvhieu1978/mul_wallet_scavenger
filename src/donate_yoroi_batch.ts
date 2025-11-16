import axios from 'axios';
import { mnemonicToEntropy } from "@meshsdk/core";
import fs from 'fs'; // [MỚI] Thêm 'fs' để đọc file

// [QUAN TRỌNG] Dùng 'require' để import CSL.
const CSL = require('@emurgo/cardano-serialization-lib-nodejs');

// --- CẤU HÌNH ---
const destination = process.env.DESTINATION_WALLET_ADDRESS as string;
const HARDENED = 0x80000000;
// [SỬA LỖI] Sửa lỗi typo từ MNECMONIC thành MNEMONIC
const mnemonic = process.env.MNEMONIC!; // Đảm bảo MNEMONIC của bạn đúng trong .env
const entropyHex = mnemonicToEntropy(mnemonic);
const entropy = Buffer.from(entropyHex, "hex");
const pwd = new Uint8Array(); 
const maxAddressIndexToScan = 40; // Giới hạn quét (tiêu chuẩn 20)
// -----------------

// --- Hàm Delay (giữ nguyên) ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// -----------------------------

/**
 * [MỚI] Lấy 'role' từ đối số dòng lệnh (command-line argument)
 * Mặc định là '0' (external/payment) nếu không cung cấp. Dùng '1' cho (internal/change).
 *
 * Cách chạy:
 * bun run src/donate_yoroi_batch.ts 0
 * hoặc
 * bun run src/donate_yoroi_batch.ts 1
 */
const roleArg = process.argv[2];
const roleToScan = (roleArg === '1') ? 1 : 0;
console.log(`--- 🚀 BẮT ĐẦU SCRIPT VỚI ROLE: ${roleToScan} (${roleToScan === 0 ? 'External/Payment' : 'Internal/Change'}) ---`);


/**
 * [MỚI] Đọc danh sách địa chỉ nguồn từ file
 */
let targetAddressList: string[];
try {
    const fileContent = fs.readFileSync('wallet_yoroi.txt', 'utf8');
    targetAddressList = fileContent.split('\n')
        .map(addr => addr.trim()) // Xóa khoảng trắng
        .filter(addr => addr.startsWith('addr1')); // Chỉ lấy địa chỉ hợp lệ
    
    if (targetAddressList.length === 0) {
        console.error("❌ Không tìm thấy địa chỉ 'addr1...' hợp lệ nào trong file wallet_yoroi.txt.");
        process.exit(1);
    }
    console.log(`✅ Đã tìm thấy ${targetAddressList.length} địa chỉ nguồn trong 'wallet_yoroi.txt'. Bắt đầu xử lý...`);
} catch (e) {
    console.error("❌ Lỗi: Không thể đọc file 'wallet_yoroi.txt'. Hãy đảm bảo file tồn tại cùng thư mục với script.", e.message);
    process.exit(1);
}

// Chuẩn bị message (chỉ 1 lần)
const message = `Assign accumulated Scavenger rights to: ${destination}`;
const messageBytes = Buffer.from(message, "utf-8"); // Chuyển message sang bytes


/**
 * [MỚI] Hàm chính để chạy logic
 */
async function processDonations() {
    // [VÒNG LẶP MỚI] Lặp qua từng địa chỉ trong file
    for (const [i, targetAddress] of targetAddressList.entries()) {
        
        console.log(`\n======================================================`);
        console.log(`Đang xử lý địa chỉ ${i + 1} / ${targetAddressList.length}: ${targetAddress.substring(0, 20)}...`);
        console.log(`======================================================`);
        
        // Reset 'addressFound' cho mỗi địa chỉ mới
        let addressFound = false; 

        // 1. Giải mã địa chỉ mục tiêu (targetAddress)
        let targetPaymentKeyHash: string;
        try {
            const cslAddress = CSL.Address.from_bech32(targetAddress);
            const baseAddress = CSL.BaseAddress.from_address(cslAddress);
            
            if (!baseAddress) {
                console.warn("⚠️ Cảnh báo: Địa chỉ không phải là Base Address (có thể là enterprise). Bỏ qua...");
                continue; // Bỏ qua địa chỉ này
            }

            const paymentCred = baseAddress.payment_cred();
            targetPaymentKeyHash = Buffer.from(paymentCred.to_keyhash().to_bytes()).toString("hex");
            console.log("   🔑 Payment Key Hash cần tìm:", targetPaymentKeyHash.substring(0, 20) + '...');

        } catch (e) {
            console.error(`❌ Lỗi giải mã địa chỉ ${targetAddress}:`, e.message);
            continue; // Bỏ qua địa chỉ này và tiếp tục vòng lặp
        }

        // 2. Bắt đầu vòng lặp quét (giống file cũ)
        for(let index = Number(process.env.ACCOUNT_INDEX_START); index < (Number(process.env.AMOUNT_ACCOUNT)+ Number(process.env.ACCOUNT_INDEX_START)); index ++) {
            if (addressFound) break; // Đã tìm thấy key, thoát vòng lặp account

            console.log(`   ...Đang quét Account ${index}`);

            // [MỚI] Thêm try...catch để bọc logic derive key
            try {
                const rootKey = CSL.Bip32PrivateKey.from_bip39_entropy(entropy, pwd);
                const accountKey = rootKey
                    .derive(1852 | HARDENED)
                    .derive(1815 | HARDENED)
                    .derive(index | HARDENED);

                // Vòng lặp quét Address Index
                for (let addressIndex = 0; addressIndex < maxAddressIndexToScan; addressIndex++) {
                    
                    // 3. Derive payment key
                    // [THAY ĐỔI] Sử dụng 'roleToScan' đã chọn
                    const paymentKey = accountKey.derive(roleToScan).derive(addressIndex); // KHÔNG hardened
                    const paymentPubKey = paymentKey.to_public();
                    
                    // 4. Hash public key vừa derive
                    const derivedPaymentKeyHash = Buffer.from(paymentPubKey.to_raw_key().hash().to_bytes()).toString("hex");

                    // 5. So sánh hai hash
                    if (derivedPaymentKeyHash === targetPaymentKeyHash) {
                        console.log(`   ✅✅✅ TÌM THẤY KEY! (Account ${index}, Role ${roleToScan}, Address Index ${addressIndex})`);
                        addressFound = true;

                        // 6. Ký bằng key vừa tìm thấy
                        const rawPrivateKey = paymentKey.to_raw_key();
                        const cslSignature = rawPrivateKey.sign(messageBytes);
                        const signatureHex = cslSignature.to_hex();
                        
                        const pubKeyHex = Buffer
                            .from(paymentKey.to_public().to_raw_key().as_bytes())
                            .toString("hex");

                        // 7. Gửi (Submit)
                        const donateUrl = `${process.env.BASE_URL}/donate_to/${destination}/${targetAddress}/${signatureHex}`;
                        console.log(`   ...Đang gửi tới API: ${donateUrl.substring(0, 80)}...`);

                        try {
                            const {data} = await axios.post(
                                    donateUrl,
                                    {}, 
                                    { headers: { 'Content-Type': 'application/json' } }
                                );
                            console.log("   ✅ API Response:", data);
                        } catch(error) {
                           if (axios.isAxiosError(error)) {
                               console.error("   ❌ Lỗi Axios:", error.response?.data || error.message);
                           } else {
                               console.error("   ❌ Lỗi:", error.message);
                           }
                        }
                        
                        console.log(`   ...Tạm dừng 2 giây...`);
                        await delay(2000); // Giữ delay 2 giây
                        
                        break; // Thoát vòng lặp 'addressIndex'
                    }
                } // --- Kết thúc vòng lặp 'addressIndex' ---
            
            } catch (deriveError) {
                // [MỚI] Bắt lỗi nếu CSL derive key thất bại
                console.error(`   ❌ Lỗi nghiêm trọng khi derive key cho Account ${index}:`, deriveError.message);
                // Không 'break' hoặc 'continue', để nó thử account tiếp theo (nếu có)
            }
        } // --- Kết thúc vòng lặp 'index' (account) ---

        if (!addressFound) {
            console.log(`   ❌ Không tìm thấy key cho địa chỉ ${targetAddress} trong các account/role đã quét.`);
        }
    } // --- [KẾT THÚC VÒNG LẶP MỚI] ---
    
    console.log("\n🎉🎉🎉 Đã hoàn tất xử lý tất cả địa chỉ trong file.");
}

// Chạy hàm chính
processDonations();
