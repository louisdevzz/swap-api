const express = require("express");
const axios = require("axios");
const redis = require('redis');
const bodyParser = require('body-parser')
const cors=require("cors");
const nearAPI  = require('near-api-js');
const { connect, KeyPair, keyStores, utils ,transactions} = nearAPI;
const BN = require('bn.js')
const math = require("mathjs")
const BigNumber = require("bignumber.js");
const Big = require('big.js');
require('dotenv').config();


const app = express();
const PORT = 5000;
const client = redis.createClient({
    host:"127.0.0.1",
    port:6379
});
const corsOptions ={
    origin:'*', 
    credentials:true,            //access-control-allow-credentials:true
    optionSuccessStatus:200,
};

const ACCOUNT_ID = process.env.NEXT_PUBLIC_RELAYER_ACCOUNT_ID_NEAR_TESTNET;
const networkId = process.env.NEXT_PUBLIC_NETWORK_ID;
const REF_FI_CONTRACT_ID = 'ref-finance-101.testnet';
const WRAP_NEAR_CONTRACT_ID = "wrap.testnet"
const STORAGE_TO_REGISTER_WITH_MFT = "0.1";

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));
app.use(cors(corsOptions)); // Use this after the variable declaration


(async()=>{ 
    await client.connect();
    client.on('error', (err) => {
        console.log(err.message);
    })


    const keyStore = new keyStores.InMemoryKeyStore();
    // creates a keyPair from the private key provided in your .env file
    const keyPair = KeyPair.fromString(process.env.RELAYER_PRIVATE_KEY_NEAR_TESTNET);
    // adds the key you just created to your keyStore which can hold multiple keys
    await keyStore.setKey(networkId, ACCOUNT_ID, keyPair);

    // configuration used to connect to NEAR
    const config = {
      networkId,
      keyStore,
      nodeUrl: `https://rpc.${networkId}.near.org`,
      walletUrl: `https://wallet.${networkId}.near.org`,
      helperUrl: `https://helper.${networkId}.near.org`,
      explorerUrl: `https://explorer.${networkId}.near.org`
    };
    const near = await connect(config);
    const senderAccount = await near.account(ACCOUNT_ID);
    const minAmountOut = "38582709410714";

    const toNonDivisibleNumber = (decimals,number) => {
    if (decimals === null || decimals === undefined) return number;
    const [wholePart, fracPart = ""] = number.split(".");
  
    return `${wholePart}${fracPart.padEnd(decimals, "0").slice(0, decimals)}`
      .replace(/^0+/, "")
      .padStart(1, "0");
    };

    const transferWallet = async(receiverId,amount)=>{
        const args={
            receiver_id: receiverId,
            amount: amount,
        }
        const senderAccount = await near.account(ACCOUNT_ID);
        const action = transactions.functionCall(
            "ft_transfer",
            args,
            new BN("200000000000000"),
            new BN("1")
        )
        const result = await senderAccount.signAndSendTransaction({
            receiverId:'usdt.fakes.testnet',
            actions:[
              action
            ]
        })
        return result;
    }

    const ftViewFunction = async (tokenId,{
      methodName,
      args,
    }) => {
      try {
          console.log("args: ",args);
          console.log("tokenId: ",tokenId)
          const account = await near.account(ACCOUNT_ID);
          // args:{"account_id":ACCOUNT_ID}
          let data = await account.viewFunction({
              contractId:tokenId,
              methodName:methodName,
              args:args
          });
          return data;
      } catch (error) {
          console.log("er", error);
      }
    };
    const ftGetStorageBalance = (
      tokenId
    ) => {
      return ftViewFunction(
          tokenId,
          {methodName:'storage_balance_of',
          args:{"account_id":ACCOUNT_ID}
      })
    };
    const swap = async ({tokenIn,tokenOut,amountIn})=>{
        try{
          if (tokenIn.id === WRAP_NEAR_CONTRACT_ID) {
            const registered = await ftGetStorageBalance(WRAP_NEAR_CONTRACT_ID);
            if (registered === null) {
              const registerAccountOnToken = async() => {
                const registerToken = await senderAccount.functionCall({
                  contractId: WRAP_NEAR_CONTRACT_ID,
                  methodName: "storage_deposit",
                  args: {
                    registration_only: true,
                    account_id: ACCOUNT_ID,
                  },
                  gas: "30000000000000",
                  amount: STORAGE_TO_REGISTER_WITH_MFT,
                });
                return registerToken;
              };
              return registerAccountOnToken;
            }
          }
          // if (tokenIn.id === WRAP_NEAR_CONTRACT_ID) {
          //   return nearDepositTransaction(amountIn);
          // }
          const actionsList = [
            {
              pool_id: 34,
              token_in: tokenIn.id,
              token_out: tokenOut.id,
              amount_in:toNonDivisibleNumber(24,amountIn),
              min_amount_out: "38582709410714",
            }
          ]
          const args={
            receiver_id: REF_FI_CONTRACT_ID,
            amount: toNonDivisibleNumber(24,amountIn),
            msg: JSON.stringify({
              force: 0,
              actions: actionsList,
            }),
          }
          const action = await senderAccount.functionCall({
            contractId: WRAP_NEAR_CONTRACT_ID,
            methodName: "ft_transfer_call",
            args: args,
            attachedDeposit: new BN("1"),
            gas: new BN("300000000000000")
          })
          return action;
        }catch(err){
          console.log(err)
        }
        
    }

    app.post("/api/v1/users/",async(req,res)=>{
        try{
            const order = {
                tokenIn: req.body.tokenIn,
                tokenOut: req.body.tokenOut,
                amountIn: req.body.amountIn,
                transfer: req.body.transfer,
                sender: req.body.sender,
            }
            const resultSwap = swap({tokenIn:order['tokenIn'],tokenOut:order['tokenOut'],amountIn:order['amountIn']})
            //['tokenIn']['id']
            //console.log(result)
            if(resultSwap){
                const resultTransfer = transferWallet(order['sender'],minAmountOut)
                console.log(resultTransfer)
                res.send(resultTransfer)
            }
            //const result = transferWallet(order['sender'],"38582709410714")
        }catch(err){
            console.log(err)
            res.send(err.message)
        }
    })
    
    
    app.listen(PORT,()=>{
        console.log(`server running on port ${PORT}`)
    })
    
    module.exports = app    
})();
