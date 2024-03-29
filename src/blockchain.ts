import {
    prop,
    method,
    SmartContractLib,
    hash256,
    Sha256,
    Utils,
    ByteString,
    toByteString,
    assert,
    slice,
    lshift,
} from 'scrypt-ts'
import { MerkleProof, MerklePath } from './merklePath'

export type BlockHeader = {
    version: ByteString
    prevBlockHash: Sha256
    merkleRoot: Sha256
    time: bigint
    bits: ByteString // Difficulty target
    nonce: bigint
}

export class Blockchain extends SmartContractLib {
    // Block height's position relative to the beginning of coinbase tx.
    // TODO: This assumes unlocking script can be pushed using OP_PUSH_1. See if it always holds?
    @prop()
    static readonly BLOCK_HEIGHT_POS: bigint = 42n

    // SPV: Is a txid in a block
    @method()
    static txInBlock(
        txid: Sha256,
        bh: BlockHeader,
        merkleProof: MerkleProof,
        depth: number
    ): boolean {
        return (
            MerklePath.calcMerkleRoot(txid, merkleProof, depth) == bh.merkleRoot
        )
    }

    // Check if tx is the last within block using its merkle path.
    @method()
    static isLastTxInBlock(merkleProof: MerkleProof, depth: number): boolean {
        let last = true

        for (let i = 0; i < depth; i++) {
            const node = merkleProof[i]

            if (node.pos != MerklePath.INVALID_NODE) {
                if (node.pos != MerklePath.LEFT_NODE) {
                    last = false
                }
            }
        }

        return last
    }

    // Calculate a tx's index in a block from its merkle path.
    @method()
    static txIndex(
        txid: Sha256,
        merkleProof: MerkleProof,
        depth: number
    ): bigint {
        let root = txid
        let sum = 0n

        for (let i = 0; i < depth; i++) {
            const node = merkleProof[i]

            if (node.pos != MerklePath.INVALID_NODE) {
                if (node.pos == MerklePath.LEFT_NODE) {
                    // Check if duplicate.
                    if (root != node.hash) {
                        sum += lshift(1n, BigInt(i))
                    }
                    root = Sha256(hash256(node.hash + root))
                } else {
                    root = Sha256(hash256(root + node.hash))
                }
            }
        }

        return sum
    }

    // Get number of transactions in a block based using its last tx merkle path.
    @method()
    static blockTxCount(
        lastTxid: Sha256,
        merkleProof: MerkleProof,
        depth: number
    ): bigint {
        // Ensure this tx is indeed the last one.
        assert(Blockchain.isLastTxInBlock(merkleProof, depth))
        return Blockchain.txIndex(lastTxid, merkleProof, depth) + 1n
    }

    // Is block header valid with difficulty meeting target.
    @method()
    static isValidBlockHeader(
        bh: BlockHeader,
        blockchainTarget: bigint
    ): boolean {
        const bhHash = Blockchain.blockHeaderHashAsInt(bh)
        const target = Blockchain.bits2Target(bh.bits)
        // Block hash below target and target below blockchain difficulty target.
        return bhHash <= target && target <= blockchainTarget
    }

    @method()
    static verifyBlockHeader(bh: BlockHeader): boolean {
        const bhHash = Blockchain.blockHeaderHashAsInt(bh)
        const target = Blockchain.bits2Target(bh.bits)
        // Block hash below target
        return bhHash <= target
    }

    // Is a chain of block headers valid.
    // TODO

    // Is raw transaction a coinbase tx.
    @method()
    static isCoinbase(tx: ByteString): boolean {
        return (
            slice(tx, 4n, 5n) == toByteString('01') && // only 1 input
            slice(tx, 5n, 37n) ==
                toByteString(
                    '0000000000000000000000000000000000000000000000000000000000000000'
                ) && // null txid: all zeros
            slice(tx, 37n, 41n) == toByteString('ffffffff')
        ) // null vout: all Fs
    }

    // Get height of the block identified by the header.
    @method()
    static blockHeight(
        bh: BlockHeader,
        coinbaseTx: ByteString,
        merkleProof: MerkleProof,
        depth: number
    ): bigint {
        // Ensure coinbase it's in the block.
        assert(
            Blockchain.txInBlock(
                Sha256(hash256(coinbaseTx)),
                bh,
                merkleProof,
                depth
            )
        )

        // Ensure it's the coinbase.
        assert(MerklePath.isCoinbase(merkleProof, depth))

        return Blockchain.readBlockHeight(coinbaseTx)
    }

    // Parse block height from coinbase tx: BIP34
    @method()
    static readBlockHeight(coinbaseTx: ByteString): bigint {
        // Block height is at the beginning of the unlocking script and encoded in varint.
        return Utils.fromLEUnsigned(
            Utils.readVarint(slice(coinbaseTx, Blockchain.BLOCK_HEIGHT_POS))
        )
    }

    // Convert difficulty from bits to target.
    @method()
    static bits2Target(bits: ByteString): bigint {
        const exponent = Utils.fromLEUnsigned(slice(bits, 3n))
        const coefficient = Utils.fromLEUnsigned(slice(bits, 0n, 3n))
        const n = 8n * (exponent - 3n)
        return lshift(coefficient, n)
    }

    // Serialize a block header.
    @method()
    static serialize(bh: BlockHeader): ByteString {
        return (
            bh.version +
            bh.prevBlockHash +
            bh.merkleRoot +
            Utils.toLEUnsigned(bh.time, 4n) +
            bh.bits +
            Utils.toLEUnsigned(bh.nonce, 4n)
        )
    }

    @method()
    static deserialize(bh: ByteString): BlockHeader {
        return {
            version: slice(bh, 0n, 4n),
            prevBlockHash: Sha256(slice(bh, 4n, 36n)),
            merkleRoot: Sha256(slice(bh, 36n, 68n)),
            time: Utils.fromLEUnsigned(slice(bh, 68n, 72n)),
            bits: slice(bh, 72n, 76n),
            nonce: Utils.fromLEUnsigned(slice(bh, 76n, 80n)),
        }
    }

    // Block header hash.
    @method()
    static blockHeaderHash(bh: BlockHeader): Sha256 {
        return hash256(Blockchain.serialize(bh))
    }

    // Block header hash, but converted to a positive integer.
    @method()
    static blockHeaderHashAsInt(bh: BlockHeader): bigint {
        return Utils.fromLEUnsigned(Blockchain.blockHeaderHash(bh))
    }
}
