// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Quorum} from "../src/Quorum.sol";
import {CommitRevealVote} from "../src/CommitRevealVote.sol";

interface Vm {
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
}

contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertEq(uint256 a, uint256 b) internal pure {
        require(a == b, "not equal");
    }

    function assertTrue(bool value) internal pure {
        require(value, "not true");
    }
}

contract CommitRevealVoteTest is TestBase {
    Quorum internal token;
    CommitRevealVote internal vote;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        token = new Quorum();
        vote = new CommitRevealVote(address(token));
        token.transfer(alice, 100 ether);
        token.transfer(bob, 100 ether);
        vm.prank(alice);
        token.approve(address(vote), type(uint256).max);
        vm.prank(bob);
        token.approve(address(vote), type(uint256).max);
    }

    function testFullVoteAndConservation() public {
        uint256 id = vote.openProposal(keccak256("title"), uint64(block.timestamp + 10), uint64(block.timestamp + 20));
        bytes32 aliceSalt = keccak256("alice salt");
        bytes32 bobSalt = keccak256("bob salt");
        vm.prank(alice);
        vote.commitVote(id, keccak256(abi.encode(true, aliceSalt)), 60 ether);
        vm.prank(bob);
        vote.commitVote(id, keccak256(abi.encode(false, bobSalt)), 25 ether);
        assertEq(token.balanceOf(address(vote)), 85 ether);

        vm.warp(block.timestamp + 10);
        vm.prank(alice);
        vote.revealVote(id, true, aliceSalt);
        vm.prank(bob);
        vote.revealVote(id, false, bobSalt);
        (,,, uint256 againstVotes, uint256 forVotes) = vote.proposals(id);
        assertEq(forVotes, 60 ether);
        assertEq(againstVotes, 25 ether);

        vm.warp(block.timestamp + 10);
        vm.prank(alice);
        vote.reclaim(id);
        vm.prank(bob);
        vote.reclaim(id);
        assertEq(token.balanceOf(address(vote)), 0);
        assertEq(token.balanceOf(alice), 100 ether);
        assertEq(token.balanceOf(bob), 100 ether);
    }

    function testUnrevealedVoterCanReclaimWithoutAffectingTotals() public {
        uint256 id = _open();
        vm.prank(alice);
        vote.commitVote(id, keccak256(abi.encode(true, bytes32("secret"))), 7 ether);
        vm.warp(block.timestamp + 20);
        vm.prank(alice);
        vote.reclaim(id);
        (,,, uint256 againstVotes, uint256 forVotes) = vote.proposals(id);
        assertEq(againstVotes + forVotes, 0);
        assertEq(token.balanceOf(alice), 100 ether);
    }

    function testRejectsInvalidDeadlinesAndZeroToken() public {
        vm.expectRevert(CommitRevealVote.InvalidToken.selector);
        new CommitRevealVote(address(0));
        vm.expectRevert(CommitRevealVote.InvalidDeadlines.selector);
        vote.openProposal(bytes32(0), uint64(block.timestamp), uint64(block.timestamp + 2));
        vm.expectRevert(CommitRevealVote.InvalidDeadlines.selector);
        vote.openProposal(bytes32(0), uint64(block.timestamp + 2), uint64(block.timestamp + 2));
    }

    function testCommitFailuresAndBoundary() public {
        uint256 id = _open();
        vm.prank(alice);
        vm.expectRevert(CommitRevealVote.ZeroAmount.selector);
        vote.commitVote(id, bytes32(uint256(1)), 0);
        vm.prank(alice);
        vm.expectRevert(CommitRevealVote.InvalidCommitment.selector);
        vote.commitVote(id, bytes32(0), 1 ether);
        vm.prank(alice);
        vote.commitVote(id, bytes32(uint256(1)), 1 ether);
        vm.prank(alice);
        vm.expectRevert(CommitRevealVote.AlreadyCommitted.selector);
        vote.commitVote(id, bytes32(uint256(2)), 1 ether);
        vm.warp(block.timestamp + 10);
        vm.prank(bob);
        vm.expectRevert(CommitRevealVote.CommitPhaseClosed.selector);
        vote.commitVote(id, bytes32(uint256(2)), 1 ether);
        vm.expectRevert(CommitRevealVote.UnknownProposal.selector);
        vote.commitVote(999, bytes32(uint256(2)), 1 ether);
    }

    function testRevealFailuresAndBoundaries() public {
        uint256 id = _open();
        bytes32 salt = bytes32("salt");
        vm.prank(alice);
        vote.commitVote(id, keccak256(abi.encode(true, salt)), 4 ether);
        vm.prank(alice);
        vm.expectRevert(CommitRevealVote.RevealPhaseClosed.selector);
        vote.revealVote(id, true, salt);
        vm.warp(block.timestamp + 10);
        vm.prank(alice);
        vm.expectRevert(CommitRevealVote.InvalidReveal.selector);
        vote.revealVote(id, false, salt);
        vm.prank(bob);
        vm.expectRevert(CommitRevealVote.NoCommitment.selector);
        vote.revealVote(id, true, salt);
        vm.prank(alice);
        vote.revealVote(id, true, salt);
        vm.prank(alice);
        vm.expectRevert(CommitRevealVote.AlreadyRevealed.selector);
        vote.revealVote(id, true, salt);
        vm.warp(block.timestamp + 10);
        vm.prank(alice);
        vm.expectRevert(CommitRevealVote.RevealPhaseClosed.selector);
        vote.revealVote(id, true, salt);
    }

    function testReclaimFailuresAndBoundary() public {
        uint256 id = _open();
        vm.prank(alice);
        vote.commitVote(id, bytes32(uint256(1)), 3 ether);
        vm.prank(alice);
        vm.expectRevert(CommitRevealVote.TooEarlyToReclaim.selector);
        vote.reclaim(id);
        vm.warp(block.timestamp + 20);
        vm.prank(bob);
        vm.expectRevert(CommitRevealVote.NoCommitment.selector);
        vote.reclaim(id);
        vm.prank(alice);
        vote.reclaim(id);
        vm.prank(alice);
        vm.expectRevert(CommitRevealVote.AlreadyReclaimed.selector);
        vote.reclaim(id);
    }

    function testInsufficientBalanceOrAllowanceRevertsWithoutBallot() public {
        uint256 id = _open();
        address poor = address(0xBAD);
        vm.prank(poor);
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", uint256(0x11)));
        vote.commitVote(id, bytes32(uint256(1)), 1 ether);
        (bytes32 commitment,,,) = vote.ballots(id, poor);
        assertTrue(commitment == bytes32(0));
    }

    function _open() private returns (uint256) {
        return vote.openProposal(bytes32("title"), uint64(block.timestamp + 10), uint64(block.timestamp + 20));
    }
}

contract AdversarialToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    CommitRevealVote public target;
    uint256 public targetProposal;
    bool public attack;
    bool public returnFalse;

    constructor() {
        balanceOf[msg.sender] = 100 ether;
    }

    function setTarget(CommitRevealVote target_, uint256 proposal_) external {
        target = target_;
        targetProposal = proposal_;
    }

    function configure(bool attack_, bool returnFalse_) external {
        attack = attack_;
        returnFalse = returnFalse_;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (attack) target.commitVote(targetProposal, bytes32(uint256(99)), 1);
        if (returnFalse) return false;
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (attack) target.reclaim(targetProposal);
        if (returnFalse) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MaliciousTokenTest is TestBase {
    AdversarialToken internal token;
    CommitRevealVote internal vote;
    uint256 internal id;

    function setUp() public {
        token = new AdversarialToken();
        vote = new CommitRevealVote(address(token));
        id = vote.openProposal(bytes32("x"), uint64(block.timestamp + 10), uint64(block.timestamp + 20));
        token.setTarget(vote, id);
        token.approve(address(vote), type(uint256).max);
    }

    function testRejectsCommitReentrancyAndRollsBackState() public {
        token.configure(true, false);
        vm.expectRevert(CommitRevealVote.Reentrancy.selector);
        vote.commitVote(id, bytes32(uint256(1)), 2 ether);
        (bytes32 commitment,,,) = vote.ballots(id, address(this));
        assertTrue(commitment == bytes32(0));
        assertEq(token.balanceOf(address(vote)), 0);
    }

    function testRejectsFalseTransferFrom() public {
        token.configure(false, true);
        vm.expectRevert(CommitRevealVote.TokenTransferFailed.selector);
        vote.commitVote(id, bytes32(uint256(1)), 2 ether);
        (bytes32 commitment,,,) = vote.ballots(id, address(this));
        assertTrue(commitment == bytes32(0));
    }

    function testRejectsReclaimReentrancyAndFalseTransfer() public {
        vote.commitVote(id, bytes32(uint256(1)), 2 ether);
        vm.warp(block.timestamp + 20);
        token.configure(true, false);
        vm.expectRevert(CommitRevealVote.Reentrancy.selector);
        vote.reclaim(id);
        (,,, bool reclaimed) = vote.ballots(id, address(this));
        assertTrue(!reclaimed);
        token.configure(false, true);
        vm.expectRevert(CommitRevealVote.TokenTransferFailed.selector);
        vote.reclaim(id);
        (,,, reclaimed) = vote.ballots(id, address(this));
        assertTrue(!reclaimed);
    }
}
