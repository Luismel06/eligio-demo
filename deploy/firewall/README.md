# RIVNU firewall candidate

Do not execute these commands without a current backup and an approved sudo
session. Resolve rule numbers again immediately before deleting a rule.

VM2 required addition after reviewing `sudo ufw status numbered`:

```bash
sudo ufw allow from 10.0.0.2 to 10.0.0.3 port 4001 proto tcp comment 'RIVNU API from VM1 reverse proxy'
sudo ufw status numbered
```

Rollback: identify the newly added rule by its exact comment and delete that
specific current rule number:

```bash
sudo ufw status numbered
sudo ufw delete NUMBER_CONFIRMED_IMMEDIATELY_ABOVE
```

Existing Web rule `3001/tcp` from `10.0.0.2` remains unchanged. Never allow
3001/4001 from `Anywhere`, the public VM2 interface, or IPv6.

VM3 must permit PostgreSQL 5432 only from VM2 `10.0.0.3`; inspect current UFW
and `pg_hba.conf` with administrative access before proposing an exact diff.
