import {
  computeExecHash,
  getFactory,
  snapshotGasCost,
} from "../../utils/testUtils";

import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import {
  L2NovaRegistry__factory,
  MockCrossDomainMessenger,
  MockCrossDomainMessenger__factory,
  MockERC20,
  SimpleDSGuard,
  SimpleDSGuard__factory,
  MockERC20__factory,
  L2NovaRegistry,
} from "../../typechain";

describe("L2_NovaRegistry", function () {
  let signers: SignerWithAddress[];
  before(async () => {
    signers = await ethers.getSigners();
  });

  let L2_NovaRegistry: L2NovaRegistry;
  let SimpleDSGuard: SimpleDSGuard;

  /// Mocks
  let MockETH: MockERC20;
  let MockCrossDomainMessenger: MockCrossDomainMessenger;

  const fakeStrategyAddress = "0x4200000000000000000000000000000000000069";
  const fakeExecutionManagerAddress =
    "0xDeADBEEF1337caFEBAbE1337CacAfACe1337C0dE";

  describe("constructor/setup", function () {
    it("should properly deploy mocks", async function () {
      MockETH = await (
        await getFactory<MockERC20__factory>("MockERC20")
      ).deploy();

      MockCrossDomainMessenger = await (
        await getFactory<MockCrossDomainMessenger__factory>(
          "MockCrossDomainMessenger"
        )
      ).deploy();
    });

    it("should properly deploy the registry", async function () {
      L2_NovaRegistry = await (
        await getFactory<L2NovaRegistry__factory>("L2_NovaRegistry")
      ).deploy(MockETH.address, MockCrossDomainMessenger.address);
    });

    it("should allow connecting to an execution manager", async function () {
      await L2_NovaRegistry.connectExecutionManager(
        fakeExecutionManagerAddress
      );

      await L2_NovaRegistry.L1_NovaExecutionManagerAddress().should.eventually.equal(
        fakeExecutionManagerAddress
      );
    });

    it("should properly use constructor arguments", async function () {
      // Make sure the constructor params were properly entered.
      await L2_NovaRegistry.messenger().should.eventually.equal(
        MockCrossDomainMessenger.address
      );

      await L2_NovaRegistry.ETH().should.eventually.equal(MockETH.address);
    });

    it("should contain constants that match expected values", async function () {
      // Make sure that the MIN_UNLOCK_DELAY_SECONDS is as expected.
      await L2_NovaRegistry.MIN_UNLOCK_DELAY_SECONDS().should.eventually.equal(
        300
      );
    });

    describe("simpleDSGuard", function () {
      it("should properly deploy a SimpleDSGuard", async function () {
        SimpleDSGuard = await (
          await getFactory<SimpleDSGuard__factory>("SimpleDSGuard")
        ).deploy();
      });

      it("should properly init the owner", async function () {
        const [deployer] = signers;

        await SimpleDSGuard.owner().should.eventually.equal(deployer.address);
      });

      it("should properly permit authorization for specific functions", async function () {
        await SimpleDSGuard.permitAnySource(
          L2_NovaRegistry.interface.getSighash(
            "requestExec(address,bytes,uint64,uint256,uint256,(address,uint256)[])"
          )
        );

        await SimpleDSGuard.permitAnySource(
          L2_NovaRegistry.interface.getSighash(
            "requestExecWithTimeout(address,bytes,uint64,uint256,uint256,(address,uint256)[],uint256)"
          )
        );

        await SimpleDSGuard.permitAnySource(
          L2_NovaRegistry.interface.getSighash(
            "speedUpRequest(bytes32,uint256)"
          )
        );

        await SimpleDSGuard.permitAnySource(
          L2_NovaRegistry.interface.getSighash("claimInputTokens(bytes32)")
        );

        await SimpleDSGuard.permitAnySource(
          L2_NovaRegistry.interface.getSighash("unlockTokens(bytes32,uint256)")
        );

        await SimpleDSGuard.permitAnySource(
          L2_NovaRegistry.interface.getSighash("relockTokens(bytes32)")
        );

        await SimpleDSGuard.permitAnySource(
          L2_NovaRegistry.interface.getSighash("withdrawTokens(bytes32)")
        );
      });

      it("should allow setting the owner to null", async function () {
        await SimpleDSGuard.setOwner(ethers.constants.AddressZero).should.not.be
          .reverted;

        await SimpleDSGuard.owner().should.eventually.equal(
          ethers.constants.AddressZero
        );
      });
    });

    describe("dsAuth", function () {
      it("should properly init the owner", async function () {
        const [deployer] = signers;

        await L2_NovaRegistry.owner().should.eventually.equal(deployer.address);
      });

      it("should allow connecting to the SimpleDSGuard", async function () {
        await L2_NovaRegistry.authority().should.eventually.equal(
          ethers.constants.AddressZero
        );

        await L2_NovaRegistry.setAuthority(SimpleDSGuard.address).should.not.be
          .reverted;

        await L2_NovaRegistry.authority().should.eventually.equal(
          SimpleDSGuard.address
        );
      });

      it("should allow setting the owner to null", async function () {
        await L2_NovaRegistry.setOwner(ethers.constants.AddressZero).should.not
          .be.reverted;

        await L2_NovaRegistry.owner().should.eventually.equal(
          ethers.constants.AddressZero
        );
      });
    });

    describe("requestExec", function () {
      it("allows a simple request", async function () {
        const [deployer] = signers;

        const gasLimit = 420;
        const gasPrice = 69;
        const tip = 1;

        await MockETH.approve(
          L2_NovaRegistry.address,
          gasLimit * gasPrice + tip
        );

        await snapshotGasCost(
          L2_NovaRegistry.requestExec(
            fakeStrategyAddress,
            "0x00",
            gasLimit,
            gasPrice,
            tip,
            []
          )
        ).should.not.be.reverted;

        const inputTokens = await L2_NovaRegistry.getRequestInputTokens(
          computeExecHash({
            nonce: 1,
            strategy: fakeStrategyAddress,
            calldata: "0x00",
            gasPrice,
          })
        );

        inputTokens.length.should.equal(0);

        await MockETH.allowance(
          L2_NovaRegistry.address,
          deployer.address
        ).should.eventually.equal(0);
      });

      it("allows a simple request with one input token", async function () {
        const [deployer] = signers;

        const gasLimit = 100_000;
        const gasPrice = 10;
        const tip = 1337;

        const inputTokenAmount = 500;

        await MockETH.approve(
          L2_NovaRegistry.address,
          gasLimit * gasPrice + tip + inputTokenAmount
        );

        await snapshotGasCost(
          L2_NovaRegistry.requestExec(
            fakeStrategyAddress,
            "0x00",
            gasLimit,
            gasPrice,
            tip,
            [{ l2Token: MockETH.address, amount: inputTokenAmount }]
          )
        );

        const inputTokens = await L2_NovaRegistry.getRequestInputTokens(
          computeExecHash({
            nonce: 2,
            strategy: fakeStrategyAddress,
            calldata: "0x00",
            gasPrice,
          })
        );

        inputTokens.length.should.equal(1);

        inputTokens[0].l2Token.should.equal(MockETH.address);
        inputTokens[0].amount.should.equal(inputTokenAmount);

        await MockETH.allowance(
          L2_NovaRegistry.address,
          deployer.address
        ).should.eventually.equal(0);
      });

      it("allows a simple request with 2 input tokens", async function () {
        const [deployer] = signers;

        const gasLimit = 100_000;
        const gasPrice = 10;
        const tip = 1337;

        const inputToken1Amount = 1000;
        const inputToken2Amount = 5000;

        await MockETH.approve(
          L2_NovaRegistry.address,
          gasLimit * gasPrice + tip + inputToken1Amount + inputToken2Amount
        );

        await snapshotGasCost(
          L2_NovaRegistry.requestExec(
            fakeStrategyAddress,
            "0x00",
            gasLimit,
            gasPrice,
            tip,
            [
              { l2Token: MockETH.address, amount: inputToken1Amount },
              { l2Token: MockETH.address, amount: inputToken2Amount },
            ]
          )
        );

        const inputTokens = await L2_NovaRegistry.getRequestInputTokens(
          computeExecHash({
            nonce: 3,
            strategy: fakeStrategyAddress,
            calldata: "0x00",
            gasPrice,
          })
        );

        inputTokens.length.should.equal(2);

        inputTokens[0].l2Token.should.equal(MockETH.address);
        inputTokens[0].amount.should.equal(inputToken1Amount);

        inputTokens[1].l2Token.should.equal(MockETH.address);
        inputTokens[1].amount.should.equal(inputToken2Amount);

        await MockETH.allowance(
          L2_NovaRegistry.address,
          deployer.address
        ).should.eventually.equal(0);
      });

      it("does not allow for more than 5 input tokens", async function () {
        await L2_NovaRegistry.requestExec(
          fakeStrategyAddress,
          "0x00",
          0,
          0,
          0,
          [
            { l2Token: ethers.constants.AddressZero, amount: 0 },
            { l2Token: ethers.constants.AddressZero, amount: 0 },
            { l2Token: ethers.constants.AddressZero, amount: 0 },
            { l2Token: ethers.constants.AddressZero, amount: 0 },
            { l2Token: ethers.constants.AddressZero, amount: 0 },
            { l2Token: ethers.constants.AddressZero, amount: 0 },
          ]
        ).should.be.revertedWith("TOO_MANY_INPUTS");
      });
    });

    describe("requestExecWithTimeout", function () {
      it("should allow a simple request with minimum timeout", async function () {
        const unlockDelaySeconds =
          await L2_NovaRegistry.MIN_UNLOCK_DELAY_SECONDS();

        await snapshotGasCost(
          L2_NovaRegistry.requestExecWithTimeout(
            fakeStrategyAddress,
            "0x00",
            0,
            0,
            0,
            [],
            unlockDelaySeconds
          )
        );

        await L2_NovaRegistry.getRequestUnlockTimestamp(
          computeExecHash({
            nonce: 4,
            strategy: fakeStrategyAddress,
            calldata: "0x00",
            gasPrice: 0,
          })
        ).should.eventually.equal(
          (await ethers.provider.getBlock("latest")).timestamp +
            unlockDelaySeconds.toNumber()
        );
      });

      it("should revert if delay is too small", async function () {
        L2_NovaRegistry.requestExecWithTimeout(
          fakeStrategyAddress,
          "0x00",
          0,
          0,
          0,
          [],
          // 1 second less than the min delay
          (await L2_NovaRegistry.MIN_UNLOCK_DELAY_SECONDS()).sub(1)
        ).should.be.revertedWith("DELAY_TOO_SMALL");
      });
    });

    describe("unlockTokens", function () {
      it("does not allow unlocking random requests", async function () {
        await L2_NovaRegistry.unlockTokens(
          computeExecHash({
            nonce: 0,
            strategy: fakeStrategyAddress,
            calldata: "0x00",
            gasPrice: 0,
          }),
          999999999999
        ).should.be.revertedWith("NOT_CREATOR");
      });

      it("does not allow unlocking requests with a small delay", async function () {
        await L2_NovaRegistry.unlockTokens(
          // This execHash is a real request we made in the `allows a simple request` test.
          computeExecHash({
            nonce: 1,
            strategy: fakeStrategyAddress,
            calldata: "0x00",
            gasPrice: 69,
          }),
          0
        ).should.be.revertedWith("DELAY_TOO_SMALL");
      });

      it("does not allow unlocking requests already scheduled to unlock", async function () {
        await L2_NovaRegistry.unlockTokens(
          // This execHash is a real request we made in the `should allow a simple request with minimum timeout` test.
          computeExecHash({
            nonce: 4,
            strategy: fakeStrategyAddress,
            calldata: "0x00",
            gasPrice: 0,
          }),
          0
        ).should.be.revertedWith("UNLOCK_ALREADY_SCHEDULED");
      });
    });
  });
});
