chạy lệnh
```
git clone https://github.com/nvhieu1978/mul_wallet_scavenger.git
cd mul_wallet_scavenger
npm i
```
Sửa file cấu hình .env 
```
cp .env.example .env
nano .env
```
Cài đặt bun.sh 

```     
curl -fsSL https://bun.sh/install | bash 
```

vậy là xong, giờ thay vì dùng `node index.js` thì dùng
```
bun run src/index.ts
```
