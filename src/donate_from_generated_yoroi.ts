/*****************************************************************************************
 *  Donate Script — CIP-8 Signer (Ed25519 / COSESign1)
 *  ---------------------------------------------------
 *  ✔ Derive key bằng CSL (Bip32PrivateKey)
 *  ✔ Ký COSESign1 chuẩn CIP-8 giống Lucid / Nami / Eternl
 *  ✔ Quét account / role / addressIndex
 *  ✔ Gửi API donate
 *****************************************************************************************/

import axios from "axios";
import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";
import { mnemonicToEntropy } from "@meshsdk/core";
import nacl from "tweetnacl";
import * as cbor from "cbor";

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
const HARDENED = 0x80000000;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

function hexToBytes(hex: string): Uint8Array {
    const h = hex.length % 2 ? "0" + hex : hex;
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
}
function bytesToHex(b: Uint8Array | Buffer): string {
    return Buffer.from(b).toString("hex");
}
function base64UrlEncode(bytes: Uint8Array): string {
    return Buffer.from(bytes)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

// ------------------------------------------------------------
// CIP-8 COSESign1 Signer
// ------------------------------------------------------------
export function signCip8(message: string, addressBech32: string, paymentKey: CSL.Bip32PrivateKey) {
    const payload = Buffer.from(message, "utf8");

    // 1) Protected header: { 1: -8 }  (alg = EdDSA)
    const protectedMap = new Map<number, number>();
    protectedMap.set(1, -8);
    const protectedBytes = cbor.encode(protectedMap);

    // 2) Unprotected header
    const addressBytes = CSL.Address.from_bech32(addressBech32).to_bytes();
    const pubKeyBytes = paymentKey.to_public().to_raw_key().as_bytes();

    const unprotected = {
        address: Buffer.from(addressBytes),
        key_id: Buffer.from(pubKeyBytes),
    };

    // 3) Sig_structure
    const sigStructure = [
        "Signature1",
        Buffer.from(protectedBytes),    // body_protected
        Buffer.from([]),                // external AAD
        Buffer.from(payload),           // payload
    ];
    const sigStructureBytes = cbor.encode(sigStructure);

    // 4) Sign Ed25519
    const rawPriv = paymentKey.to_raw_key();
    const signatureBytes = rawPriv.sign(sigStructureBytes).to_bytes();

    // 5) COSE_Sign1 array
    const coseArray = [
        Buffer.from(protectedBytes),
        unprotected,
        Buffer.from(payload),
        Buffer.from(signatureBytes),
    ];

    const coseBinary = cbor.encode(coseArray);

    return {
        hex: bytesToHex(coseBinary),
        base64url: base64UrlEncode(coseBinary),
    };
}

// ------------------------------------------------------------
// MAIN
// ------------------------------------------------------------

const destination = process.env.DESTINATION_WALLET_ADDRESS!;
const mnemonic = process.env.MNEMONIC!;
const entropyHex = mnemonicToEntropy(mnemonic);
const entropy = Buffer.from(entropyHex, "hex");
const pwd = new Uint8Array();

const START = Number(process.env.ACCOUNT_INDEX_START ?? 0);
const COUNT = Number(process.env.AMOUNT_ACCOUNT ?? 1);
const ADDRESS_PER_ROLE = 40;

const roleArg = process.argv[2];
const rolesToProcess = roleArg === "1" ? [1] : roleArg === "2" ? [0, 1] : [0];

const message = `Assign accumulated Scavenger rights to: ${destination}`;

console.log("=====================================================");
console.log("🚀 CIP-8 Donate Script Started");
console.log("Roles:", rolesToProcess);
console.log("=====================================================");

async function main() {
    for (let accIndex = START; accIndex < START + COUNT; accIndex++) {
        console.log(`\n================ ACCOUNT ${accIndex} ================`);

        try {
            // Derive account key
            const rootKey = CSL.Bip32PrivateKey.from_bip39_entropy(entropy, pwd);

            const accountKey = rootKey
                .derive(1852 | HARDENED)
                .derive(1815 | HARDENED)
                .derive(accIndex | HARDENED);

            // Stake key
            const stakeKey = accountKey.derive(2).derive(0);
            const StakeCredClass = CSL.Credential || CSL.StakeCredential;
            const stakeCred = StakeCredClass.from_keyhash(
                stakeKey.to_public().to_raw_key().hash()
            );

            for (const role of rolesToProcess) {
                console.log(`\n---- Role ${role} ----`);

                for (let addrIndex = 0; addrIndex < ADDRESS_PER_ROLE; addrIndex++) {
                    const paymentKey = accountKey.derive(role).derive(addrIndex);
                    const paymentPub = paymentKey.to_public();

                    const paymentCred = StakeCredClass.from_keyhash(
                        paymentPub.to_raw_key().hash()
                    );

                    const baseAddr = CSL.BaseAddress.new(
                        CSL.NetworkInfo.mainnet().network_id(),
                        paymentCred,
                        stakeCred
                    );
                    const address = baseAddr.to_address().to_bech32();

                    console.log(`[${addrIndex}] ${address}`);

                    // ----------- CIP-8 SIGN -----------
                    const signed = signCip8(message, address, paymentKey);

                    // ----------- SEND TO API ----------
                    const donateUrl = `${process.env.BASE_URL}/donate_to/${destination}/${address}/${signed.hex}`;
                    console.log("API:", donateUrl);

                    try {
                        const { data } = await axios.post(donateUrl, {}, {
                            headers: { "Content-Type": "application/json" }
                        });
                        console.log("   ✅ OK:", data);
            			 } catch (err: any) {
            			    console.log("❌ API ERROR OCCURRED");
            
            			    if (err.response) {
            				console.log("👉 Status:", err.response.status);
            				console.log("👉 StatusText:", err.response.statusText);
            
            				console.log("👉 FULL ERROR DATA (server trả về):");
            				if (typeof err.response.data === "object") {
            				    // Nếu server trả về object JSON
            				    console.log(JSON.stringify(err.response.data, null, 2));
            				} else {
            				    // Nếu server trả về string
            				    try {
            					console.log(JSON.stringify(JSON.parse(err.response.data), null, 2));
            				    } catch {
            					console.log(err.response.data);
            				    }
            				}
            
            
            			    } else if (err.request) {
            				console.log("❌ Không nhận được response từ server");
            				console.log(err.request);
            			    } else {
            				console.log("❌ Lỗi khi tạo request:", err.message);
            			    }
            
            			}



					await delay(1000);
					}
				    }
				} catch (e: any) {
				    console.log("❌ Lỗi account:", e.message);
				}
			    }

    console.log("\n🎉 DONE.");
}

main();
