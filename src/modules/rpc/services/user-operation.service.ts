import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { USER_OPERATION_STATUS, UserOperation, UserOperationDocument } from '../schemas/user-operation.schema';
import { UserOperationEvent, UserOperationEventDocument } from '../schemas/user-operation-event.schema';
import { BigNumber } from '../../../common/bignumber';
import { getAddress } from 'ethers';
import { TRANSACTION_STATUS, Transaction, TransactionDocument } from '../schemas/transaction.schema';
import { AppException } from '../../../common/app-exception';
import { Helper } from '../../../common/helper';
import { splitOriginNonce } from '../aa/utils';

@Injectable()
export class UserOperationService {
    public constructor(
        @InjectModel(UserOperation.name) private readonly userOperationModel: Model<UserOperationDocument>,
        @InjectModel(UserOperationEvent.name) private readonly userOperationEventModel: Model<UserOperationEventDocument>,
        @InjectModel(Transaction.name) private readonly transactionModel: Model<TransactionDocument>,
    ) {}

    // TODO: should use mongodb transaction
    public async createOrUpdateUserOperation(
        chainId: number,
        userOp: any,
        userOpHash: string,
        entryPoint: string,
        userOpDoc?: UserOperationDocument,
    ) {
        const userOpSender = getAddress(userOp.sender);
        const { nonceKey, nonceValue } = splitOriginNonce(userOp.nonce);

        const nonceValueString = BigNumber.from(nonceValue).toString();
        Helper.assertTrue(nonceValueString.length <= 30, -32608);

        userOpDoc = userOpDoc ?? (await this.getUserOperationByAddressNonce(chainId, userOpSender, nonceKey, nonceValueString));

        // Allow to replace failed user operation, because the nonce of the user operation is not increased
        if (userOpDoc) {
            Helper.assertTrue(userOpDoc.status === USER_OPERATION_STATUS.DONE, -32607);

            const transaction = await this.transactionModel.findOne({ chainId, txHash: userOpDoc.txHash });
            // Allowing to replace tx if it happened more than 60 minutes ago
            if (
                Date.now() - userOpDoc.createdAt.getTime() < 60 * 60 * 1000 &&
                (!transaction || transaction.status !== TRANSACTION_STATUS.FAILED)
            ) {
                throw new AppException(-32004);
            }

            return {
                userOpDoc: await this.resetToLocal(userOpDoc, userOpHash, entryPoint, userOp),
            };
        }

        const userOperation = new this.userOperationModel({
            userOpHash,
            userOpSender: userOp.sender,
            userOpNonceKey: nonceKey,
            userOpNonce: nonceValueString,
            chainId,
            entryPoint,
            origin: userOp,
            status: USER_OPERATION_STATUS.LOCAL,
        });

        userOperation.save(); // async save

        return {
            userOpDoc: userOperation,
        };
    }

    public async deleteAllLocalUserOperations(chainId: number) {
        await this.userOperationModel.deleteMany({
            chainId,
            status: { $in: [USER_OPERATION_STATUS.LOCAL, USER_OPERATION_STATUS.TO_BE_REPLACE] },
        });
    }

    public async getUserOperationByAddressNonce(
        chainId: number,
        userOpSender: string,
        userOpNonceKey: string,
        userOpNonce: string,
    ): Promise<UserOperationDocument> {
        return await this.userOperationModel.findOne({ chainId, userOpSender, userOpNonceKey, userOpNonce });
    }

    public async getSuccessUserOperationNonce(chainId: number, userOpSender: string, userOpNonceKey: string): Promise<string> {
        const userOpDoc = await this.userOperationModel
            .findOne({ chainId, userOpSender, userOpNonceKey, status: USER_OPERATION_STATUS.DONE })
            .sort({ userOpNonce: -1 });
        if (!userOpDoc) {
            return null;
        }

        const userOpEvent = await this.userOperationEventModel.findOne({ chainId, userOperationHash: userOpDoc.userOpHash });
        if (!userOpEvent) {
            return null;
        }

        return userOpDoc.userOpNonce.toString();
    }

    public async getUserOperationByHash(chainId: number, userOpHash: string): Promise<UserOperationDocument> {
        return await this.userOperationModel.findOne({ chainId, userOpHash });
    }

    public async getUserOperationByHashes(chainId: number, userOpHashes: string[]): Promise<UserOperationDocument[]> {
        return await this.userOperationModel.find({ chainId, userOpHash: { $in: userOpHashes } });
    }

    public async getLocalUserOperationsByDuration(chainId: number, startAt: number, endAt: number): Promise<UserOperationDocument[]> {
        return await this.userOperationModel.find({
            chainId,
            status: USER_OPERATION_STATUS.LOCAL,
            createdAt: { $gt: new Date(startAt), $lte: new Date(endAt) },
        });
    }

    public async getLocalUserOperations(limit = 1000): Promise<UserOperationDocument[]> {
        return await this.userOperationModel
            .find({
                status: USER_OPERATION_STATUS.LOCAL,
            })
            .limit(limit);
    }

    // Ensure nonce is sorted by asc
    public async getLocalUserOperationsByChainIdAndSortByCreatedAt(
        chainId: number,
        entryPoint: string,
        limit = 100,
    ): Promise<UserOperationDocument[]> {
        return await this.userOperationModel
            .find({ chainId, status: USER_OPERATION_STATUS.LOCAL, entryPoint })
            .sort({ createdAt: 1 })
            .limit(limit);
    }

    public async transactionSetSpecialLocalUserOperationsAsPending(
        userOperationDocument: UserOperationDocument[],
        txHash: string,
        session: any,
    ) {
        const ids = userOperationDocument.map((u) => u._id);

        return await this.userOperationModel.updateMany(
            { _id: { $in: ids }, status: USER_OPERATION_STATUS.LOCAL },
            { $set: { status: USER_OPERATION_STATUS.PENDING, txHash } },
            { session },
        );
    }

    public async transactionSetUserOperationsAsDone(
        chainId: number,
        userOpHashes: string[],
        txHash: string,
        blockNumber: number,
        blockHash: string,
        session: any = null,
    ) {
        return await this.userOperationModel.updateMany(
            { chainId, userOpHash: { $in: userOpHashes }, status: USER_OPERATION_STATUS.PENDING },
            { $set: { status: USER_OPERATION_STATUS.DONE, txHash, blockNumber, blockHash } },
            { session },
        );
    }

    public async getUserOperationEvent(chainId: number, userOperationHash: string): Promise<UserOperationEventDocument> {
        return await this.userOperationEventModel.findOne({ chainId, userOperationHash });
    }

    public async createOrGetUserOperationEvent(
        chainId: number,
        userOperationHash: string,
        txHash: string,
        contractAddress: string,
        topic: string,
        args: any,
    ): Promise<UserOperationEventDocument> {
        const event = await this.getUserOperationEvent(chainId, userOperationHash);
        if (event) {
            return event;
        }

        const userOperation = new this.userOperationEventModel({
            chainId,
            txHash,
            contractAddress,
            userOperationHash,
            topic,
            args,
        });

        return await userOperation.save();
    }

    public async resetToLocal(userOperationDocument: UserOperationDocument, userOpHash: string, entryPoint: string, userOp: any) {
        userOperationDocument.userOpHash = userOpHash;
        userOperationDocument.entryPoint = entryPoint;
        userOperationDocument.origin = userOp;
        userOperationDocument.status = USER_OPERATION_STATUS.LOCAL;
        userOperationDocument.createdAt = new Date();
        return await userOperationDocument.save();
    }
}
