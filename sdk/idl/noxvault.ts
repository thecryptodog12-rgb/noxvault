/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/noxvault.json`.
 */
export type Noxvault = {
  "address": "8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4",
  "metadata": {
    "name": "noxvault",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "cancelUnlock",
      "docs": [
        "Closes an unlock buffer and returns its rent. Only the payer who opened it."
      ],
      "discriminator": [
        116,
        58,
        36,
        132,
        24,
        104,
        170,
        228
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true,
          "relations": [
            "unlock"
          ]
        },
        {
          "name": "unlock",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "executePending",
      "docs": [
        "Pays out the pending SOL withdrawal once its delay has passed. Permissionless."
      ],
      "discriminator": [
        207,
        36,
        5,
        220,
        230,
        106,
        57,
        181
      ],
      "accounts": [
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "state"
          ]
        },
        {
          "name": "dest",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "executePendingToken",
      "docs": [
        "Pays out the pending token withdrawal once its delay has passed. Permissionless."
      ],
      "discriminator": [
        154,
        74,
        76,
        145,
        26,
        82,
        200,
        60
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "relations": [
            "state"
          ]
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "dest"
        },
        {
          "name": "destAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "dest"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "finishAdmin",
      "docs": [
        "Cancel (drops the pending withdrawal) and Ping (proves the owner is alive)."
      ],
      "discriminator": [
        59,
        221,
        148,
        135,
        221,
        17,
        113,
        147
      ],
      "accounts": [
        {
          "name": "unlock",
          "writable": true
        },
        {
          "name": "rentReceiver",
          "writable": true
        },
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "state"
          ]
        },
        {
          "name": "feePayee",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "finishCollectStake",
      "docs": [
        "Moves everything in a deactivated stake account back into the vault."
      ],
      "discriminator": [
        11,
        112,
        175,
        231,
        205,
        225,
        187,
        113
      ],
      "accounts": [
        {
          "name": "unlock",
          "writable": true
        },
        {
          "name": "rentReceiver",
          "writable": true
        },
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "state"
          ]
        },
        {
          "name": "stake",
          "writable": true
        },
        {
          "name": "feePayee",
          "writable": true
        },
        {
          "name": "clock",
          "address": "SysvarC1ock11111111111111111111111111111111"
        },
        {
          "name": "stakeHistory",
          "address": "SysvarStakeHistory1111111111111111111111111"
        },
        {
          "name": "stakeProgram",
          "address": "Stake11111111111111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "finishStake",
      "docs": [
        "Opens a stake account owned by the vault and delegates it. Permissionless once verified."
      ],
      "discriminator": [
        96,
        239,
        26,
        63,
        103,
        215,
        246,
        139
      ],
      "accounts": [
        {
          "name": "unlock",
          "writable": true
        },
        {
          "name": "rentReceiver",
          "writable": true
        },
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "state"
          ]
        },
        {
          "name": "stake",
          "writable": true
        },
        {
          "name": "vote"
        },
        {
          "name": "feePayee",
          "writable": true
        },
        {
          "name": "clock",
          "address": "SysvarC1ock11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        },
        {
          "name": "stakeHistory",
          "address": "SysvarStakeHistory1111111111111111111111111"
        },
        {
          "name": "stakeConfig",
          "address": "StakeConfig11111111111111111111111111111111"
        },
        {
          "name": "stakeProgram",
          "address": "Stake11111111111111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "finishUnstake",
      "docs": [
        "Deactivates one of the vault's stake accounts. Permissionless once verified."
      ],
      "discriminator": [
        36,
        39,
        141,
        104,
        51,
        93,
        247,
        144
      ],
      "accounts": [
        {
          "name": "unlock",
          "writable": true
        },
        {
          "name": "rentReceiver",
          "writable": true
        },
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "state"
          ]
        },
        {
          "name": "stake",
          "writable": true
        },
        {
          "name": "feePayee",
          "writable": true
        },
        {
          "name": "clock",
          "address": "SysvarC1ock11111111111111111111111111111111"
        },
        {
          "name": "stakeHistory",
          "address": "SysvarStakeHistory1111111111111111111111111"
        },
        {
          "name": "stakeProgram",
          "address": "Stake11111111111111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "finishWithdraw",
      "docs": [
        "Withdraws SOL (or queues it as the pending withdrawal). Permissionless once verified."
      ],
      "discriminator": [
        225,
        43,
        3,
        149,
        27,
        183,
        245,
        27
      ],
      "accounts": [
        {
          "name": "unlock",
          "writable": true
        },
        {
          "name": "rentReceiver",
          "writable": true
        },
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "state"
          ]
        },
        {
          "name": "dest",
          "writable": true
        },
        {
          "name": "feePayee",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "finishWithdrawToken",
      "docs": [
        "Withdraws an SPL / Token-2022 token (or queues it). Permissionless once verified."
      ],
      "discriminator": [
        6,
        225,
        56,
        120,
        204,
        57,
        216,
        186
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "unlock",
          "writable": true
        },
        {
          "name": "rentReceiver",
          "writable": true
        },
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "state"
          ]
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "dest"
        },
        {
          "name": "destAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "dest"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "feePayee",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initVault",
      "docs": [
        "Creates the state of a vault from its config. Permissionless: the vault address is the",
        "hash of the config, so nobody can register different rules for it."
      ],
      "discriminator": [
        77,
        79,
        85,
        150,
        33,
        217,
        52,
        106
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault"
        },
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "config",
          "type": {
            "defined": {
              "name": "config"
            }
          }
        }
      ]
    },
    {
      "name": "openUnlock",
      "discriminator": [
        197,
        205,
        244,
        64,
        180,
        220,
        149,
        55
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "relations": [
            "state"
          ]
        },
        {
          "name": "state",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "unlock",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  110,
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "payer"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "tree",
          "type": "u8"
        },
        {
          "name": "leaf",
          "type": "u16"
        },
        {
          "name": "pkSeed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "authPath",
          "type": {
            "vec": {
              "array": [
                "u8",
                32
              ]
            }
          }
        },
        {
          "name": "action",
          "type": {
            "defined": {
              "name": "action"
            }
          }
        }
      ]
    },
    {
      "name": "verify",
      "docs": [
        "Walks chains `from..to` to their ends. Freezes the buffer on first use. Permissionless."
      ],
      "discriminator": [
        133,
        161,
        141,
        48,
        120,
        198,
        88,
        150
      ],
      "accounts": [
        {
          "name": "unlock",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "from",
          "type": "u8"
        },
        {
          "name": "to",
          "type": "u8"
        }
      ]
    },
    {
      "name": "writeSigs",
      "discriminator": [
        216,
        242,
        142,
        114,
        134,
        77,
        2,
        154
      ],
      "accounts": [
        {
          "name": "payer",
          "signer": true,
          "relations": [
            "unlock"
          ]
        },
        {
          "name": "vault",
          "docs": [
            "signature bytes shows up in the vault's history (docs/SPEC.md §8)."
          ],
          "relations": [
            "unlock"
          ]
        },
        {
          "name": "unlock",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "start",
          "type": "u8"
        },
        {
          "name": "sigs",
          "type": {
            "vec": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "unlock",
      "discriminator": [
        187,
        122,
        21,
        254,
        7,
        157,
        241,
        10
      ]
    },
    {
      "name": "vaultState",
      "discriminator": [
        228,
        196,
        82,
        165,
        98,
        210,
        235,
        152
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "wrongVault",
      "msg": "The vault address does not match"
    },
    {
      "code": 6001,
      "name": "badConfig",
      "msg": "Invalid vault config"
    },
    {
      "code": 6002,
      "name": "badTree",
      "msg": "Unknown tree, wrong auth path length or leaf out of range"
    },
    {
      "code": 6003,
      "name": "keyUsed",
      "msg": "This one-time key has already been used"
    },
    {
      "code": 6004,
      "name": "destIsVault",
      "msg": "The destination cannot be the vault itself"
    },
    {
      "code": 6005,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6006,
      "name": "badAction",
      "msg": "Action too large"
    },
    {
      "code": 6007,
      "name": "frozen",
      "msg": "The signature can no longer change: verification has started"
    },
    {
      "code": 6008,
      "name": "chainOutOfRange",
      "msg": "Chain index out of range"
    },
    {
      "code": 6009,
      "name": "signatureIncomplete",
      "msg": "Not every chain of the signature has been written"
    },
    {
      "code": 6010,
      "name": "notVerified",
      "msg": "Not every chain has been verified"
    },
    {
      "code": 6011,
      "name": "badSignature",
      "msg": "The signature does not match this vault's keys"
    },
    {
      "code": 6012,
      "name": "wrongPayer",
      "msg": "Rent receiver must be the account that opened the unlock"
    },
    {
      "code": 6013,
      "name": "wrongAction",
      "msg": "This instruction cannot execute the signed action"
    },
    {
      "code": 6014,
      "name": "wrongDest",
      "msg": "Destination does not match the signed action"
    },
    {
      "code": 6015,
      "name": "wrongFeePayee",
      "msg": "Fee payee does not match the signed action"
    },
    {
      "code": 6016,
      "name": "wrongStake",
      "msg": "Stake account does not match the signed action"
    },
    {
      "code": 6017,
      "name": "insufficientFunds",
      "msg": "The vault holds less than this needs"
    },
    {
      "code": 6018,
      "name": "rentDust",
      "msg": "The vault would be left with less SOL than the rent minimum"
    },
    {
      "code": 6019,
      "name": "recoveryLocked",
      "msg": "The recovery key may only cancel until the owner has been inactive long enough"
    },
    {
      "code": 6020,
      "name": "notWhitelisted",
      "msg": "This destination is not on the vault's whitelist"
    },
    {
      "code": 6021,
      "name": "pendingExists",
      "msg": "A withdrawal is already pending"
    },
    {
      "code": 6022,
      "name": "noPending",
      "msg": "No withdrawal is pending"
    },
    {
      "code": 6023,
      "name": "notYet",
      "msg": "The pending withdrawal's delay has not passed yet"
    }
  ],
  "types": [
    {
      "name": "action",
      "docs": [
        "What one one-time key authorizes. Signed as borsh bytes (docs/SPEC.md §5)."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "withdraw",
            "fields": [
              {
                "name": "mint",
                "type": "pubkey"
              },
              {
                "name": "dest",
                "type": "pubkey"
              },
              {
                "name": "amount",
                "type": "u64"
              },
              {
                "name": "fee",
                "type": "u64"
              },
              {
                "name": "feePayee",
                "type": "pubkey"
              }
            ]
          },
          {
            "name": "stake",
            "fields": [
              {
                "name": "seed",
                "type": "u8"
              },
              {
                "name": "vote",
                "type": "pubkey"
              },
              {
                "name": "amount",
                "type": "u64"
              },
              {
                "name": "fee",
                "type": "u64"
              },
              {
                "name": "feePayee",
                "type": "pubkey"
              }
            ]
          },
          {
            "name": "unstake",
            "fields": [
              {
                "name": "seed",
                "type": "u8"
              },
              {
                "name": "fee",
                "type": "u64"
              },
              {
                "name": "feePayee",
                "type": "pubkey"
              }
            ]
          },
          {
            "name": "collectStake",
            "fields": [
              {
                "name": "seed",
                "type": "u8"
              },
              {
                "name": "fee",
                "type": "u64"
              },
              {
                "name": "feePayee",
                "type": "pubkey"
              }
            ]
          },
          {
            "name": "cancel",
            "fields": [
              {
                "name": "fee",
                "type": "u64"
              },
              {
                "name": "feePayee",
                "type": "pubkey"
              }
            ]
          },
          {
            "name": "ping",
            "fields": [
              {
                "name": "fee",
                "type": "u64"
              },
              {
                "name": "feePayee",
                "type": "pubkey"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "config",
      "docs": [
        "The rules of a vault. Its hash is part of the vault address, so it can never change."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "primaryRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "primaryHeight",
            "type": "u8"
          },
          {
            "name": "recoveryRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "recoveryHeight",
            "type": "u8"
          },
          {
            "name": "recoveryDelay",
            "type": "i64"
          },
          {
            "name": "whitelist",
            "type": {
              "array": [
                "pubkey",
                4
              ]
            }
          },
          {
            "name": "slowDelay",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "pending",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "dest",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "executableAt",
            "type": "i64"
          },
          {
            "name": "leaf",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "unlock",
      "docs": [
        "A signed action being assembled and verified over several transactions.",
        "Zero-copy: the signature and chain ends are too big for the BPF stack."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "written",
            "docs": [
              "Bit j set once chain j's signature value is written."
            ],
            "type": "u64"
          },
          {
            "name": "verified",
            "docs": [
              "Bit j set once chain j has been walked to its end."
            ],
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "pkSeed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "authPath",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                8
              ]
            }
          },
          {
            "name": "action",
            "type": {
              "array": [
                "u8",
                160
              ]
            }
          },
          {
            "name": "actionLen",
            "type": "u16"
          },
          {
            "name": "leaf",
            "type": "u16"
          },
          {
            "name": "tree",
            "type": "u8"
          },
          {
            "name": "height",
            "type": "u8"
          },
          {
            "name": "frozen",
            "docs": [
              "1 once verification started: the message and signature can no longer change."
            ],
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "digits",
            "docs": [
              "Digits of the message digest, fixed when the buffer freezes."
            ],
            "type": {
              "array": [
                "u8",
                34
              ]
            }
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "sigs",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                34
              ]
            }
          },
          {
            "name": "ends",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                34
              ]
            }
          }
        ]
      }
    },
    {
      "name": "vaultState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "configHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "config",
            "type": {
              "defined": {
                "name": "config"
              }
            }
          },
          {
            "name": "usedPrimary",
            "docs": [
              "Bit l set once leaf l of the tree has been used."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "usedRecovery",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "lastActive",
            "type": "i64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "actions",
            "type": "u32"
          },
          {
            "name": "pending",
            "type": {
              "option": {
                "defined": {
                  "name": "pending"
                }
              }
            }
          }
        ]
      }
    }
  ]
};
