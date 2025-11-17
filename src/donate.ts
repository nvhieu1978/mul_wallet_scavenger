import axios from 'axios';
import { BlockfrostProvider, MeshWallet, mnemonicToEntropy } from "@meshsdk/core";
import { Bip32PrivateKey } from '@emurgo/cardano-serialization-lib-nodejs';

// --- BẮT ĐẦU: KIỂM TRA BIẾN MÔI TRƯỜNG ---
// Kiểm tra tất cả các biến môi trường cần thiết trước khi chạy
const apiKey = process.env.BLOCKFROST_API_KEY;
const destination = process.env.DESTINATION_WALLET_ADDRESS;
const mnemonic = process.env.MNEMONIC;
const baseUrl = process.env.BASE_URL;
const accountIndexStart = process.env.ACCOUNT_INDEX_START;
const amountAccount = process.env.AMOUNT_ACCOUNT;

const requiredEnvVars = {
    BLOCKFROST_API_KEY: apiKey,
    DESTINATION_WALLET_ADDRESS: destination, // Rất quan trọng, nếu thiếu sẽ gây lỗi 404
    MNEMONIC: mnemonic,
    BASE_URL: baseUrl,
    ACCOUNT_INDEX_START: accountIndexStart,
    AMOUNT_ACCOUNT: amountAccount
};

const missingVars = Object.entries(requiredEnvVars)
    .filter(([key, value]) => !value)
    .map(([key]) => key);

if (missingVars.length > 0) {
    console.error("LỖI: Một hoặc nhiều biến môi trường đang bị thiếu trong file .env của bạn.");
    missingVars.forEach(varName => {
        console.error(`- ${varName}`);
    });
    if (missingVars.includes("DESTINATION_WALLET_ADDRESS")) {
        console.error("\n*** LƯU Ý: Thiếu 'DESTINATION_WALLET_ADDRESS' là nguyên nhân phổ biến gây ra lỗi 404 (Not Found) khi gọi API. ***");
    }
    process.exit(1); // Thoát script với mã lỗi
}
// --- KẾT THÚC: KIỂM TRA BIẾN MÔI TRƯỜNG ---


const blockfrostProvider = new BlockfrostProvider(apiKey as string);
// const destination = process.env.DESTINATION_WALLET_ADDRESS as string (Đã được định nghĩa ở trên)

// Hàm này tạo ra một Promise sẽ hoàn thành sau 'ms' mili-giây
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// --------------------------

const HARDENED = 0x80000000;
// const mnemonic = process.env.MNEMONIC!; (Đã được định nghĩa ở trên)
const entropyHex = mnemonicToEntropy(mnemonic!);
const entropy = Buffer.from(entropyHex, "hex");
const pwd = new Uint8Array(); 

// Chuyển đổi số một lần bên ngoài vòng lặp
const indexStart = Number(accountIndexStart);
const totalAccounts = Number(amountAccount);

for(let index = indexStart; index < (totalAccounts + indexStart); index ++) {

    // --- BẮT ĐẦU: BỌC TOÀN BỘ VÒNG LẶP TRONG TRY...CATCH ---
    // Điều này đảm bảo nếu một tài khoản bị lỗi, vòng lặp vẫn tiếp tục
    try {
        console.log(`\n--- Bắt đầu xử lý tài khoản: ${index} ---`);

        const meshWallet = new MeshWallet({
            networkId: 1,
            accountIndex: index,
            fetcher: blockfrostProvider,
            submitter: blockfrostProvider,
            key: {
                type: "mnemonic",
                words: mnemonic!.split(" "),
            },
        });
        
        const address = await meshWallet.getChangeAddress();

        const message = `Assign accumulated Scavenger rights to: ${destination}`;
        const messageHex = Buffer.from(message, "utf8").toString("hex");
        const signature = await meshWallet.signData(messageHex);

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

        console.log("Account:", index);
        console.log("Address:", address);
        console.log("Public Key:", pubKeyHex);
        console.log("Signature:", signature.signature);

        // --- Bắt lỗi riêng cho GET request ---
        // Chúng ta vẫn muốn thử POST ngay cả khi GET này thất bại
        let nightAllocation = 0;
        try {
            const {data: night} = await axios.get(`https://scavenger.prod.gd.midnighttge.io/statistics/${address}`)
            nightAllocation = +Number(night?.local?.night_allocation) / 1_000_000;
            console.log("Night Allocation:", nightAllocation);
        } catch (getError: any) {
            console.warn(`CẢNH BÁO: Không thể lấy thống kê (statistics) cho tài khoản ${index}. Lỗi: ${getError.message}. Vẫn tiếp tục...`);
        }
        
        const postUrl = `${baseUrl}/donate_to/${destination}/${address}/${signature.signature}`;
        console.log("Calling POST URL:", postUrl);

        const {data} = await axios.post(
                postUrl,
                {}, 
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }
            );

        console.log(`Kết quả POST cho tài khoản ${index}:`, data)         

        // Thêm một log để biết nó đang tạm dừng
        console.log(`Đã xử lý xong tài khoản ${index}. Tạm dừng 0.5 giây...`);
        // Chờ 500 mili-giây
        await delay(500);

    } catch(error: any) {
       // --- BẮT ĐẦU: CẢI THIỆN VIỆC XỬ LÝ LỖI ---
       console.error(`\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
       console.error(`!!! LỖI NGHIÊM TRỌNG ở tài khoản ${index} !!!`);
        
       if (axios.isAxiosError(error)) {
           // Lỗi từ axios (ví dụ: 404, 500, 403, 429)
           console.error(`Lỗi HTTP: ${error.message}`);
           if (error.response) {
               // Máy chủ đã trả về một phản hồi lỗi
               console.error(`- Status: ${error.response.status} (${error.response.statusText})`);
               console.error(`- URL: ${error.config?.url}`);
               console.error(`- Data: ${JSON.stringify(error.response.data)}`);

               // Kiểm tra lỗi 404 và dấu //
               if (error.response.status === 404 && error.config?.url?.includes('/donate_to//')) {
                   console.error("\n*** PHÁT HIỆN LỖI 404 VÀ DẤU // ***");
                   console.error("*** Vui lòng kiểm tra biến DESTINATION_WALLET_ADDRESS trong file .env. Có vẻ như nó đang bị trống! ***\n");
               }
               // Kiểm tra lỗi 429 (Too Many Requests)
               if (error.response.status === 429) {
                   console.warn("*** Bị giới hạn tỷ lệ (429)! Tạm dừng 10 giây... ***");
                   await delay(10000); // Tạm dừng 10 giây nếu bị rate limit
               }

           } else if (error.request) {
               // Request đã được gửi nhưng không nhận được phản hồi
               console.error("- Không nhận được phản hồi từ máy chủ (có thể do mạng hoặc timeout).");
           }
       } else {
           // Lỗi khác (ví dụ: lỗi logic, lỗi signing...)
           console.error(`Lỗi không phải HTTP: ${error.message}`);
           console.error(error.stack); // In stack trace để debug
       }
       console.error(`...Bỏ qua tài khoản ${index} và tiếp tục vòng lặp...\n`);
       // Vòng lặp sẽ tự động tiếp tục với `index` tiếp theo
       // Thêm delay nhỏ ở đây để tránh spam log nếu lỗi xảy ra liên tục
       await delay(500);
       // --- KẾT THÚC: CẢI THIỆN VIỆC XỬ LÝ LỖI ---
    }
    // --- KẾT THÚC: BỌC TOÀN BỘ VÒNG LẶP ---
}


console.log("✅ Xử lý hoàn tất tất cả tài khoản!");
