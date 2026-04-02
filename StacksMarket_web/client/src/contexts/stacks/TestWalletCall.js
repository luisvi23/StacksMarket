import React from "react";
import { authenticate, getWalletAddress } from "../../utils/stacksConnect";
import { openSTXTransfer, openContractCall } from "@stacks/connect";
import { stringUtf8CV, fetchCallReadOnlyFunction } from "@stacks/transactions";

const TestSTXTransfer = () => {
  const handleConnect = async () => {
    try {
      const address = await authenticate();
      //console.log("Wallet connected:", address);
    } catch (err) {
      console.error("Wallet connect error:", err);
    }
  };

  const handleTransfer = async () => {
    try {
      const address = getWalletAddress();
      if (!address) {
        await authenticate();
      }

      const options = {
        recipient: "ST3J2GVMMM2R07ZFBJDWTYEYAR8FZH5WKDTFJ9AHA", // testnet address
        amount: 1000000, // microstacks (1 STX = 1_000_000 microstacks)
        memo: "Test transfer",
        network: "testnet",
        appDetails: {
          name: "StacksMarket",
          icon: "https://imglink.io/i/139bee27-a14b-4e2d-99c3-3b05d9cb6e53.png",
        },
        onFinish: (data) => {
          //console.log("Transfer successful:", data);
          //console.log(
          //  "🔗 Explorer:",
          //  `https://explorer.stacks.co/txid/${data.txId}?chain=testnet`
          //);
        },
        onCancel: () => {
          //console.log("User cancelled transfer");
        },
      };

      await openSTXTransfer(options);
    } catch (err) {
      console.error("Error during transfer:", err);
    }
  };

  const callContract = async () => {
    try {
      await openContractCall({
        network: "testnet",
        contractAddress: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
        contractName: "my-contract",
        functionName: "transfer",
        functionArgs: [], // add args if needed
        appDetails: {
          name: "StacksMarket",
          icon: "https://imglink.io/i/139bee27-a14b-4e2d-99c3-3b05d9cb6e53.png",
        },
        onFinish: (data) => {
          //console.log("Contract call finished:", data);
        },
        onCancel: () => {
          //console.log("User cancelled contract call");
        },
      });
    } catch (err) {
      //console.error("Error in contract call:", err);
    }
  };

  const writeMessage = async (message) => {
    try {
      await openContractCall({
        network: "testnet",
        contractAddress: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
        contractName: "my-contract",
        functionName: "set-message",
        functionArgs: [stringUtf8CV(message)],
        appDetails: {
          name: "StacksMarket",
          icon: "https://imglink.io/i/139bee27-a14b-4e2d-99c3-3b05d9cb6e53.png",
        },
        onFinish: (data) => {
          //console.log("Message set, tx:", data);
        },
        onCancel: () => {
          //console.log("User cancelled write");
        },
      });
    } catch (err) {
      console.error("Error in writeMessage:", err);
    }
  };

  const readMessage = async () => {
    try {
      const result = await fetchCallReadOnlyFunction({
        network: "testnet",
        contractAddress: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
        contractName: "my-contract",
        functionName: "get-message",
        functionArgs: [stringUtf8CV("id1")],
        senderAddress: getWalletAddress() || "", // must be a valid address
      });
      //console.log("Read function result:", result);
    } catch (err) {
      console.error("Error in readMessage:", err);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        <button className="btn-primary" onClick={handleConnect}>
          Connect Wallet
        </button>
        <button className="btn-secondary" onClick={handleTransfer}>
          Normal Transfer
        </button>
        <button className="btn-secondary" onClick={callContract}>
          Contract Transfer
        </button>
      </div>
      <div className="mt-4 flex gap-2">
        <button onClick={readMessage} className="btn-secondary">
          Read Message
        </button>
        <button
          onClick={() => writeMessage("Hello, Stacks!")}
          className="btn-secondary"
        >
          Write Message
        </button>
      </div>
    </>
  );
};

export default TestSTXTransfer;
