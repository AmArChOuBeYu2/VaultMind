const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("GrantRegistry Smart Contract Tests", function () {
  async function deployFixture() {
    const [owner, agent, intruder] = await ethers.getSigners();
    const GrantRegistry = await ethers.getContractFactory("GrantRegistry");
    const registry = await GrantRegistry.deploy();
    await registry.waitForDeployment();

    const docId = ethers.id("vaultmind-test-doc-123");
    return { registry, owner, agent, intruder, docId };
  }

  it("should register document and grant time-limited access", async function () {
    const { registry, owner, agent, docId } = await deployFixture();

    const latestTime = await time.latest();
    const expiry = latestTime + 3600; // 1 hour

    await expect(registry.connect(owner).grantAccess(docId, agent.address, expiry))
      .to.emit(registry, "GrantCreated")
      .withArgs(docId, owner.address, agent.address, expiry);

    const isActive = await registry.hasActiveGrant(docId, agent.address);
    expect(isActive).to.equal(true);

    const docOwner = await registry.documentOwners(docId);
    expect(docOwner).to.equal(owner.address);
  });

  it("should return false for expired grant", async function () {
    const { registry, owner, agent, docId } = await deployFixture();

    const latestTime = await time.latest();
    const expiry = latestTime + 10; // 10 seconds

    await registry.connect(owner).grantAccess(docId, agent.address, expiry);
    expect(await registry.hasActiveGrant(docId, agent.address)).to.equal(true);

    // Increase EVM block timestamp past expiry
    await time.increase(20);

    expect(await registry.hasActiveGrant(docId, agent.address)).to.equal(false);
  });

  it("should revoke access and immediately reject requests", async function () {
    const { registry, owner, agent, docId } = await deployFixture();

    const latestTime = await time.latest();
    const expiry = latestTime + 3600;

    await registry.connect(owner).grantAccess(docId, agent.address, expiry);
    expect(await registry.hasActiveGrant(docId, agent.address)).to.equal(true);

    // Revoke access onchain
    await expect(registry.connect(owner).revokeAccess(docId, agent.address))
      .to.emit(registry, "GrantRevoked")
      .withArgs(docId, owner.address, agent.address);

    expect(await registry.hasActiveGrant(docId, agent.address)).to.equal(false);
  });

  it("should reject grant or revoke attempts from non-owner accounts", async function () {
    const { registry, owner, agent, intruder, docId } = await deployFixture();

    const latestTime = await time.latest();
    const expiry = latestTime + 3600;

    // Owner grants access
    await registry.connect(owner).grantAccess(docId, agent.address, expiry);

    // Intruder attempts to revoke -> revert
    await expect(
      registry.connect(intruder).revokeAccess(docId, agent.address)
    ).to.be.revertedWith("GrantRegistry: Only document owner can revoke");

    // Intruder attempts to grant access to intruder -> revert
    await expect(
      registry.connect(intruder).grantAccess(docId, intruder.address, expiry)
    ).to.be.revertedWith("GrantRegistry: Caller is not the document owner");
  });
});
